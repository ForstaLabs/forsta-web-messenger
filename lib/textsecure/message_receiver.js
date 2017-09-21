// vim: ts=4:sw=4:expandtab
/* global WebSocketResource */

function MessageReceiver(textSecureServer, signalingKey) {
    this.server = textSecureServer;
    this.signalingKey = signalingKey;
}

MessageReceiver.prototype = new textsecure.EventTarget();
MessageReceiver.prototype.extend({
    constructor: MessageReceiver,

    connect: function() {
        if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
            this.socket.close();
        }
        this.socket = this.server.getMessageSocket();
        this.socket.onclose = this.onclose.bind(this);
        this.socket.onerror = this.onerror.bind(this);
        console.info('Websocket connecting:', this.socket.url.split('?')[0]);
        this.wsr = new WebSocketResource(this.socket, {
            handleRequest: this.handleRequest.bind(this),
            keepalive: { path: '/v1/keepalive', disconnect: true }
        });
    },

    close: function() {
        this.socket.close(3000, 'called close');
        delete this.listeners;
    },

    onerror: function(error) {
        console.error('Websocket error:', error);
    },

    onclose: async function(ev) {
        console.warn('Websocket closed:', ev.code, ev.reason || '');
        if (ev.code === 3000) {
            return;
        }
        // possible auth or network issue. Make a request to confirm
        let attempt = 0;
        while (true) {
            try {
                await this.server.getDevices();
                break;
            } catch(e) {
                const backoff = Math.log1p(++attempt) * 30 * Math.random();
                if (!navigator.onLine || e instanceof textsecure.NetworkError) {
                    console.warn("Network is offline or broken.");
                } else {
                    console.error("Invalid network state:", e);
                    const errorEvent = new Event('error');
                    errorEvent.error = e;
                    this.dispatchEvent(errorEvent);
                }
                console.info(`Will retry network in ${backoff} seconds (attempt ${attempt}).`);
                await F.util.sleep(backoff);
            }
        }
        this.connect();
    },

    handleRequest: async function(request) {
        if (request.path !== '/api/v1/message' || request.verb !== 'PUT') {
            console.error("Expected PUT /message instead of:", request);
            throw new Error('Invalid WebSocket resource received');
        }
        let envelope;
        try {
            /* We do the message decryption here, instead of in the ordered
             * async queue to avoid exposing the time it took us to process
             * messages through the time-to-ack. */
            const data = await textsecure.crypto.decryptWebsocketMessage(request.body,
                                                                         this.signalingKey);
            envelope = textsecure.protobuf.Envelope.decode(data);
        } catch(e) {
            request.respond(500, 'Bad encrypted websocket message');
            console.error("Error handling incoming message:", e);
            var ev = new Event('error');
            ev.error = e;
            this.dispatchEvent(ev);
            throw e;
        }
        /* After this point, decoding errors are not the server's
         * fault and we should ACK them to prevent bad messages from
         * wedging us.  However we want to wait until after message processing
         * has finished so each message has an opportunity to be flushed to
         * disk before we ask for another.  E.g. To prevent message loss.
         */
        try {
            await F.queueAsync(this, this.handleEnvelope.bind(this, envelope));
        } catch(e) {
            if (!(e instanceof textsecure.TextSecureError)) {
                throw e;
            } else {
                console.warn("Supressing TextSecureError:", e);
            }
        } finally {
            // See note above.
            request.respond(200, 'OK');
        }
    },

    handleEnvelope: async function(envelope) {
        if (envelope.type === textsecure.protobuf.Envelope.Type.RECEIPT) {
            this.onDeliveryReceipt(envelope);
        } else if (envelope.content) {
            await this.handleContentMessage(envelope);
        } else if (envelope.legacyMessage) {
            await this.handleLegacyMessage(envelope);
        } else {
            throw new Error('Received message with no content and no legacyMessage');
        }
    },

    getStatus: function() {
        if (this.socket) {
            return this.socket.readyState;
        } else {
            return -1;
        }
    },

    onDeliveryReceipt: function(envelope) {
        var ev = new Event('receipt');
        ev.proto = envelope;
        this.dispatchEvent(ev);
    },

    unpad: function(paddedPlaintext) {
        paddedPlaintext = new Uint8Array(paddedPlaintext);
        let plaintext;
        for (let i = paddedPlaintext.length - 1; i; i--) {
            if (paddedPlaintext[i] == 0x80) {
                plaintext = new Uint8Array(i);
                plaintext.set(paddedPlaintext.subarray(0, i));
                plaintext = plaintext.buffer;
                break;
            } else if (paddedPlaintext[i] !== 0x00) {
                throw new Error('Invalid padding');
            }
        }
        return plaintext;
    },

    decrypt: async function(envelope, ciphertext) {
        const addr = new libsignal.SignalProtocolAddress(envelope.source, envelope.sourceDevice);
        const sessionCipher = new libsignal.SessionCipher(textsecure.store, addr);
        const envTypes = textsecure.protobuf.Envelope.Type;
        let decrypt;
        if (envelope.type === envTypes.CIPHERTEXT) {
            decrypt = sessionCipher.decryptWhisperMessage(ciphertext).then(this.unpad);
        } else if (envelope.type === envTypes.PREKEY_BUNDLE) {
            decrypt = this.decryptPreKeyWhisperMessage(ciphertext, sessionCipher, addr);
        } else {
            throw new TypeError("Unknown message type:" + envelope.type);
        }
        try {
            return await decrypt;
        } catch(e) {
            const ev = new Event('error');
            ev.error = e;
            ev.proto = envelope;
            this.dispatchEvent(ev);
            throw e;
        }
    },

    decryptPreKeyWhisperMessage: async function(ciphertext, sessionCipher, address) {
        try {
            return this.unpad(await sessionCipher.decryptPreKeyWhisperMessage(ciphertext));
        } catch(e) {
            if (e.message === 'Unknown identity key') {
                // create an error that the UI will pick up and ask the
                // user if they want to re-negotiate
                const cipherBuf = ciphertext instanceof ArrayBuffer ? ciphertext :
                    ciphertext.toArrayBuffer();
                throw new textsecure.IncomingIdentityKeyError(address.toString(),
                    cipherBuf, e.identityKey);
            }
            throw e;
        }
    },

    handleSentMessage: async function(sent, envelope) {
        if (sent.message.flags & textsecure.protobuf.DataMessage.Flags.END_SESSION) {
            await this.handleEndSession(sent.destination);
        }
        await this.processDecrypted(sent.message, this.server.addr);
        const ev = new Event('sent');
        ev.data = {
            source: envelope.source,
            sourceDevice: envelope.sourceDevice,
            timestamp: sent.timestamp.toNumber(),
            destination: sent.destination,
            message: sent.message
        };
        if (sent.expire) {
          ev.data.expirationStartTimestamp = sent.expire.toNumber();
        }
        this.dispatchEvent(ev);
    },

    handleDataMessage: async function(message, envelope, content) {
        if (message.flags & textsecure.protobuf.DataMessage.Flags.END_SESSION) {
            await this.handleEndSession(envelope.source);
        }
        await this.processDecrypted(message, envelope.source);
        const ev = new Event('message');
        ev.data = {
            timestamp: envelope.timestamp.toNumber(),
            source: envelope.source,
            sourceDevice: envelope.sourceDevice,
            message
        };
        this.dispatchEvent(ev);
    },

    handleLegacyMessage: async function(envelope) {
        const data = await this.decrypt(envelope, envelope.legacyMessage);
        const message = textsecure.protobuf.DataMessage.decode(data);
        await this.handleDataMessage(message, envelope);
    },

    handleContentMessage: async function(envelope) {
        const data = await this.decrypt(envelope, envelope.content);
        const content = textsecure.protobuf.Content.decode(data);
        if (content.syncMessage) {
            await this.handleSyncMessage(content.syncMessage, envelope, content);
        } else if (content.dataMessage) {
            await this.handleDataMessage(content.dataMessage, envelope, content);
        } else {
            throw new TypeError('Got content message with no dataMessage or syncMessage');
        }
    },

    handleSyncMessage: async function(message, envelope, content) {
        if (envelope.source !== this.server.addr) {
            throw new ReferenceError('Received sync message from another addr');
        }
        if (envelope.sourceDevice == this.server.deviceId) {
            throw new ReferenceError('Received sync message from our own device');
        }
        if (message.sent) {
            await this.handleSentMessage(message.sent, envelope);
        } else if (message.read && message.read.length) {
            this.handleRead(message.read, envelope);
        } else if (message.contacts) {
            console.error("Deprecated contact sync message:", message, envelope, content);
            throw new TypeError('Deprecated contact sync message');
        } else if (message.groups) {
            console.error("Deprecated group sync message:", message, envelope, content);
            throw new TypeError('Deprecated group sync message');
        } else if (message.blocked) {
            this.handleBlocked(message.blocked, envelope);
        } else if (message.request) {
            console.error("Deprecated group request sync message:", message, envelope, content);
            throw new TypeError('Deprecated group request sync message');
        } else {
            console.error("Empty sync message:", message, envelope, content);
            throw new TypeError('Empty SyncMessage');
        }
    },

    handleRead: function(read, envelope) {
        for (const x of read) {
            const ev = new Event('read');
            ev.timestamp = envelope.timestamp.toNumber();
            ev.read = {
                timestamp: x.timestamp.toNumber(),
                sender: x.sender,
                source: envelope.source,
                sourceDevice: envelope.sourceDevice
            };
            this.dispatchEvent(ev);
        }
    },

    handleBlocked: function(blocked) {
        throw new Error("UNSUPPORTRED");
    },

    handleAttachment: async function(attachment) {
        const encData = await this.server.getAttachment(attachment.id.toString());
        const key = attachment.key.toArrayBuffer();
        attachment.data = await textsecure.crypto.decryptAttachment(encData, key);
    },

    tryMessageAgain: function(from, ciphertext) {
        var address = libsignal.SignalProtocolAddress.fromString(from);
        var sessionCipher = new libsignal.SessionCipher(textsecure.store, address);
        console.warn('retrying prekey whisper message');
        return this.decryptPreKeyWhisperMessage(ciphertext, sessionCipher, address).then(function(plaintext) {
            var finalMessage = textsecure.protobuf.DataMessage.decode(plaintext);
            var p = Promise.resolve();
            if ((finalMessage.flags & textsecure.protobuf.DataMessage.Flags.END_SESSION)
                    == textsecure.protobuf.DataMessage.Flags.END_SESSION &&
                    finalMessage.sync !== null) {
                    p = this.handleEndSession(address.getName());
            }
            return p.then(function() {
                return this.processDecrypted(finalMessage);
            }.bind(this));
        }.bind(this));
    },

    handleEndSession: async function(addr) {
        const deviceIds = await textsecure.store.getDeviceIds(addr);
        await Promise.all(deviceIds.map(deviceId => {
            const address = new libsignal.SignalProtocolAddress(addr, deviceId);
            const sessionCipher = new libsignal.SessionCipher(textsecure.store, address);
            console.warn('Closing session for', addr, deviceId);
            return sessionCipher.closeOpenSessionForDevice();
        }));
    },

    processDecrypted: async function(msg, source) {
        // Now that its decrypted, validate the message and clean it up for consumer processing
        // Note that messages may (generally) only perform one action and we ignore remaining fields
        // after the first action.
        if (msg.flags === null) {
            msg.flags = 0;
        }
        if (msg.expireTimer === null) {
            msg.expireTimer = 0;
        }
        if (msg.flags & textsecure.protobuf.DataMessage.Flags.END_SESSION) {
            return msg;
        }
        if (msg.group) {
            // We could blow up here but I want the user to have visibility...
            console.error("Legacy group message detected", msg);
        }
        if (msg.attachments) {
            await Promise.all(msg.attachments.map(this.handleAttachment.bind(this)));
        }
        return msg;
    }
});

self.textsecure = self.textsecure || {};

textsecure.MessageReceiver = function(textSecureServer, signalingKey) {
    var messageReceiver = new MessageReceiver(textSecureServer, signalingKey);
    this.addEventListener = messageReceiver.addEventListener.bind(messageReceiver);
    this.removeEventListener = messageReceiver.removeEventListener.bind(messageReceiver);
    this.getStatus = messageReceiver.getStatus.bind(messageReceiver);
    this.close = messageReceiver.close.bind(messageReceiver);
    messageReceiver.connect();
    textsecure.replay.registerFunction(messageReceiver.tryMessageAgain.bind(messageReceiver),
                                       textsecure.replay.Type.INIT_SESSION);
};

textsecure.MessageReceiver.prototype = {
    constructor: textsecure.MessageReceiver
};
