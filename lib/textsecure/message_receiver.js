// vim: ts=4:sw=4:expandtab
/* global WebSocketResource, GroupBuffer, ContactBuffer */

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
        // possible 403 or network issue. Make a request to confirm
        while (true) {
            try {
                await this.server.getDevices();
                break;
            } catch(e) {
                if (!navigator.onLine || e.message === 'Failed to fetch') {
                    console.warn("Network problems detected, retry websocket later...");
                    await F.util.sleep(Math.random() * 60);
                } else {
                    console.error("Invalid connection state:", e); 
                    var ev = new Event('error');
                    ev.error = e;
                    this.dispatchEvent(ev);
                    return;
                }
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
         * fault, and we should handle them gracefully and tell the
         * user they received an invalid message. */
        request.respond(200, 'OK');
        try {
            await F.queueAsync(this, this.handleEnvelope.bind(this, envelope));
        } catch(e) {
            if (!(e instanceof textsecure.TextSecureError)) {
                throw e;
            } else {
                console.warn("Supressing TextSecureError:", e);
            }
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
        console.warn("Received Legacy Message!");
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
            throw new Error('Got content message with no dataMessage or syncMessage');
        }
    },

    handleSyncMessage: async function(message, envelope, content) {
        if (envelope.source !== this.server.addr) {
            throw new Error('Received sync message from another addr');
        }
        if (envelope.sourceDevice == this.server.deviceId) {
            throw new Error('Received sync message from our own device');
        }
        if (message.sent) {
            await this.handleSentMessage(message.sent, envelope);
        } else if (message.read && message.read.length) {
            this.handleRead(message.read, envelope);
        } else if (message.contacts) {
            await this.handleContacts(message.contacts, envelope);
        } else if (message.groups) {
            await this.handleGroups(message.groups, envelope, content);
        } else if (message.blocked) {
            this.handleBlocked(message.blocked, envelope);
        } else if (message.request) {
            this.handleSyncRequest(message.request, envelope);
        } else {
            throw new Error('Got empty SyncMessage');
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

    handleContacts: async function(contacts) {
        const attachmentPointer = contacts.blob;
        await this.handleAttachment(attachmentPointer);
        const contactBuffer = new ContactBuffer(attachmentPointer.data);
        let contactDetails = contactBuffer.next();
        while (contactDetails !== undefined) {
            const ev = new Event('contact');
            ev.contactDetails = contactDetails;
            this.dispatchEvent(ev);
            contactDetails = contactBuffer.next();
        }
        this.dispatchEvent(new Event('contactsync'));
    },

    handleGroups: async function(groups, envelope, content) {
        const attachmentPointer = groups.blob;
        await this.handleAttachment(attachmentPointer);
        const groupBuffer = new GroupBuffer(attachmentPointer.data);
        let groupDetails = groupBuffer.next();
        while (groupDetails !== undefined) {
            groupDetails.id = groupDetails.id.toBinary();
            if (groupDetails.active) {
                const existingGroup = await textsecure.store.getGroup(groupDetails.id);
                if (existingGroup === undefined) {
                    await textsecure.store.createGroup(groupDetails.members, groupDetails.id);
                } else {
                    await textsecure.store.updateGroupAddrs(groupDetails.id, groupDetails.members);
                }
            }
            const ev = new Event('group');
            ev.groupDetails = groupDetails;
            if (content.dataMessage) {
                // Web clients set this to all the conversation attributes.
                ev.extra = JSON.parse(content.dataMessage.body);
            }
            this.dispatchEvent(ev);
            groupDetails = groupBuffer.next();
        }
        this.dispatchEvent(new Event('groupSync'));
    },

    handleSyncRequest: async function(request, envelope) {
        const types = textsecure.protobuf.SyncMessage.Request.Type;
        if (request.type !== types.GROUPS) {
            console.warn("Ignoring unhandled sync request:", request.type, envelope);
            return;
        }
        const ev = new Event('groupSyncRequest');
        ev.data = {
            timestamp: envelope.timestamp.toNumber(),
            source: envelope.source,
            sourceDevice: envelope.sourceDevice,
        };
        this.dispatchEvent(ev);
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
            msg.group.id = msg.group.id.toBinary();
            if (msg.group.type == textsecure.protobuf.GroupContext.Type.UPDATE) {
                if (msg.group.avatar) {
                    await this.handleAttachment(msg.group.avatar);
                }
            }
            const existingAddrs = await textsecure.store.getGroupAddrs(msg.group.id);
            if (!existingAddrs) {
                if (msg.group.type != textsecure.protobuf.GroupContext.Type.UPDATE) {
                    console.error("Got message for unknown group with members:", msg.group.members);
                    if (!msg.group.members || !msg.group.members.length) {
                        console.error("Unknown group with unknown membership.  Can only add self and source!");
                        const ourAddr = await textsecure.store.getState('addr');
                        msg.group.members = [source, ourAddr];
                    }
                }
                await textsecure.store.createGroup(msg.group.members, msg.group.id);
            } else {
                const fromIndex = existingAddrs.indexOf(source);
                if (fromIndex === -1) {
                    console.error("Sender was not a member of the group they were sending from");
                }
                if (msg.group.type === textsecure.protobuf.GroupContext.Type.UPDATE) {
                    await textsecure.store.updateGroupAddrs(msg.group.id, msg.group.members);
                } else if (msg.group.type === textsecure.protobuf.GroupContext.Type.QUIT) {
                    if (source === this.server.addr) {
                        await textsecure.store.deleteGroup(msg.group.id);
                    } else {
                        await textsecure.store.removeGroupAddrs(msg.group.id, [source]);
                    }
                }
            }
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
