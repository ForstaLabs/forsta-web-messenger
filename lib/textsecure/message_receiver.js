// vim: ts=4:sw=4:expandtab
/* global WebSocketResource, dcodeIO */

(function() {

    const ns = self.textsecure = self.textsecure || {};

    ns.MessageReceiver = class MessageReceiver extends ns.EventTarget {

        constructor(tss, addr, deviceId, signalingKey, noWebSocket) {
            super();
            console.assert(tss && addr && deviceId && signalingKey);
            this.tss = tss;
            this.addr = addr;
            this.deviceId = deviceId;
            this.signalingKey = signalingKey;
            if (!noWebSocket) {
                const url = this.tss.getMessageWebSocketURL();
                this.wsr = new WebSocketResource(url, {
                    handleRequest: request => F.queueAsync(this, this.handleRequest.bind(this, request)),
                    keepalive: {
                        path: '/v1/keepalive',
                        disconnect: true
                    }
                });
                this.wsr.addEventListener('close', this.onSocketClose.bind(this));
                this.wsr.addEventListener('error', this.onSocketError.bind(this));
            }
            // XXX strange (unused?) api...
            ns.replay.registerFunction(this.tryMessageAgain.bind(this),
                                       ns.replay.Type.INIT_SESSION);
        }

        connect() {
            this.wsr.connect();
        }

        close() {
            this.wsr.close();
        }

        async drain() {
            /* Pop messages directly from the messages API until it's empty. */
            if (this.wsr) {
                throw new TypeError("Fetch is invalid when websocket is in use");
            }
            let more;
            do {
                const data = await this.tss.request({call: 'messages'});
                more = data.more;
                const deleting = [];
                for (const envelope of data.messages) {
                    if (envelope.content) {
                        envelope.content = dcodeIO.ByteBuffer.fromBase64(envelope.content);
                    }
                    if (envelope.message) {
                        envelope.legacyMessage = dcodeIO.ByteBuffer.fromBase64(envelope.message);
                    }
                    await this.handleEnvelope(envelope);
                    deleting.push(this.tss.request({
                        call: 'messages',
                        httpType: 'DELETE',
                        urlParameters: `/${envelope.source}/${envelope.timestamp}`
                    }));
                }
                await Promise.all(deleting);
            } while(more);
        }

        onSocketError(error) {
            console.error('Websocket error:', error);
        }

        async onSocketClose(ev) {
            console.warn('Websocket closed:', ev.code, ev.reason || '');
            if (ev.code === 3000) {
                return;
            }
            // possible auth or network issue. Make a request to confirm
            let attempt = 0;
            while (true) {
                try {
                    await this.tss.getDevices();
                    break;
                } catch(e) {
                    const backoff = Math.log1p(++attempt) * 30 * Math.random();
                    if (!navigator.onLine || e instanceof ns.NetworkError) {
                        console.warn("Network is offline or broken.");
                    } else {
                        console.error("Invalid network state:", e);
                        const errorEvent = new Event('error');
                        errorEvent.error = e;
                        await this.dispatchEvent(errorEvent);
                    }
                    console.info(`Will retry network in ${backoff} seconds (attempt ${attempt}).`);
                    await F.util.sleep(backoff);
                }
            }
            this.connect();
        }

        async handleRequest(request) {
            if (request.path !== '/api/v1/message' || request.verb !== 'PUT') {
                console.error("Expected PUT /message instead of:", request);
                throw new Error('Invalid WebSocket resource received');
            }
            let envelope;
            try {
                const data = await ns.crypto.decryptWebsocketMessage(request.body, this.signalingKey);
                envelope = ns.protobuf.Envelope.decode(data);
                envelope.timestamp = envelope.timestamp.toNumber();
            } catch(e) {
                request.respond(500, 'Bad encrypted websocket message');
                console.error("Error handling incoming message:", e);
                const ev = new Event('error');
                ev.error = e;
                await this.dispatchEvent(ev);
                throw e;
            }
            /* After this point, decoding errors are not the server's
             * fault and we should ACK them to prevent bad messages from
             * wedging us. */
            try {
                await this.handleEnvelope(envelope);
            } finally {
                request.respond(200, 'OK');
            }
        }

        async handleEnvelope(envelope, reentrant) {
            let handler;
            if (envelope.type === ns.protobuf.Envelope.Type.RECEIPT) {
                handler = this.handleDeliveryReceipt;
            } else if (envelope.content) {
                handler = this.handleContentMessage;
            } else if (envelope.legacyMessage) {
                handler = this.handleLegacyMessage;
            } else {
                throw new Error('Received message with no content and no legacyMessage');
            }
            try {
                await handler.call(this, envelope);
            } catch(e) {
                if (e.name === 'MessageCounterError') {
                    console.warn("Ignoring MessageCounterError for:", envelope);
                    return;
                } else if (e instanceof ns.IncomingIdentityKeyError && !reentrant) {
                    const ev = new Event('keychange');
                    ev.addr = e.addr;
                    ev.identityKey = e.identityKey;
                    await this.dispatchEvent(ev);
                    if (ev.accepted) {
                        envelope.keyChange = true;
                        return await this.handleEnvelope(envelope, /*reentrant*/ true);
                    }
                } else if (e instanceof ns.TextSecureError) {
                    console.warn("Supressing TextSecureError:", e);
                } else {
                    const ev = new Event('error');
                    ev.error = e;
                    ev.proto = envelope;
                    await this.dispatchEvent(ev);
                    throw e;
                }
            }
        }

        async handleDeliveryReceipt(envelope) {
            const ev = new Event('receipt');
            ev.proto = envelope;
            await this.dispatchEvent(ev);
        }

        unpad(paddedPlaintext) {
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
        }

        async decrypt(envelope, ciphertext) {
            const addr = new libsignal.SignalProtocolAddress(envelope.source, envelope.sourceDevice);
            const sessionCipher = new libsignal.SessionCipher(ns.store, addr);
            const envTypes = ns.protobuf.Envelope.Type;
            if (envelope.type === envTypes.CIPHERTEXT) {
                return await sessionCipher.decryptWhisperMessage(ciphertext).then(this.unpad);
            } else if (envelope.type === envTypes.PREKEY_BUNDLE) {
                return await this.decryptPreKeyWhisperMessage(ciphertext, sessionCipher, addr);
            } else {
                throw new TypeError("Unknown message type:" + envelope.type);
            }
        }

        async decryptPreKeyWhisperMessage(ciphertext, sessionCipher, address) {
            try {
                return this.unpad(await sessionCipher.decryptPreKeyWhisperMessage(ciphertext));
            } catch(e) {
                if (e.message === 'Unknown identity key') {
                    const cipherBuf = ciphertext instanceof ArrayBuffer ? ciphertext :
                        ciphertext.toArrayBuffer();
                    throw new ns.IncomingIdentityKeyError(address.toString(), cipherBuf,
                                                          e.identityKey);
                }
                throw e;
            }
        }

        async handleSentMessage(sent, envelope) {
            if (sent.message.flags & ns.protobuf.DataMessage.Flags.END_SESSION) {
                await this.handleEndSession(sent.destination);
            }
            await this.processDecrypted(sent.message, this.addr);
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
            await this.dispatchEvent(ev);
        }

        async handleDataMessage(message, envelope, content) {
            if (message.flags & ns.protobuf.DataMessage.Flags.END_SESSION) {
                await this.handleEndSession(envelope.source);
            }
            await this.processDecrypted(message, envelope.source);
            const ev = new Event('message');
            ev.data = {
                timestamp: envelope.timestamp,
                source: envelope.source,
                sourceDevice: envelope.sourceDevice,
                message,
                keyChange: envelope.keyChange
            };
            await this.dispatchEvent(ev);
        }

        async handleLegacyMessage(envelope) {
            const data = await this.decrypt(envelope, envelope.legacyMessage);
            const message = ns.protobuf.DataMessage.decode(data);
            await this.handleDataMessage(message, envelope);
        }

        async handleContentMessage(envelope) {
            const data = await this.decrypt(envelope, envelope.content);
            const content = ns.protobuf.Content.decode(data);
            if (content.syncMessage) {
                await this.handleSyncMessage(content.syncMessage, envelope, content);
            } else if (content.dataMessage) {
                await this.handleDataMessage(content.dataMessage, envelope, content);
            } else {
                throw new TypeError('Got content message with no dataMessage or syncMessage');
            }
        }

        async handleSyncMessage(message, envelope, content) {
            if (envelope.source !== this.addr) {
                throw new ReferenceError('Received sync message from another addr');
            }
            if (envelope.sourceDevice == this.deviceId) {
                throw new ReferenceError('Received sync message from our own device');
            }
            if (message.sent) {
                await this.handleSentMessage(message.sent, envelope);
            } else if (message.read && message.read.length) {
                await this.handleRead(message.read, envelope);
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
        }

        async handleRead(read, envelope) {
            for (const x of read) {
                const ev = new Event('read');
                ev.timestamp = envelope.timestamp;
                ev.read = {
                    timestamp: x.timestamp.toNumber(),
                    sender: x.sender,
                    source: envelope.source,
                    sourceDevice: envelope.sourceDevice
                };
                await this.dispatchEvent(ev);
            }
        }

        handleBlocked(blocked) {
            throw new Error("UNSUPPORTRED");
        }

        async handleAttachment(attachment) {
            const encData = await this.tss.getAttachment(attachment.id.toString());
            const key = attachment.key.toArrayBuffer();
            attachment.data = await ns.crypto.decryptAttachment(encData, key);
        }

        tryMessageAgain(from, ciphertext) {
            const address = libsignal.SignalProtocolAddress.fromString(from);
            const sessionCipher = new libsignal.SessionCipher(ns.store, address);
            console.warn('retrying prekey whisper message');
            return this.decryptPreKeyWhisperMessage(ciphertext, sessionCipher, address).then(function(plaintext) {
                const finalMessage = ns.protobuf.DataMessage.decode(plaintext);
                let p = Promise.resolve();
                if ((finalMessage.flags & ns.protobuf.DataMessage.Flags.END_SESSION)
                        == ns.protobuf.DataMessage.Flags.END_SESSION &&
                        finalMessage.sync !== null) {
                        p = this.handleEndSession(address.getName());
                }
                return p.then(function() {
                    return this.processDecrypted(finalMessage);
                }.bind(this));
            }.bind(this));
        }

        async handleEndSession(addr) {
            const deviceIds = await ns.store.getDeviceIds(addr);
            await Promise.all(deviceIds.map(deviceId => {
                const address = new libsignal.SignalProtocolAddress(addr, deviceId);
                const sessionCipher = new libsignal.SessionCipher(ns.store, address);
                console.warn('Closing session for', addr, deviceId);
                return sessionCipher.closeOpenSessionForDevice();
            }));
        }

        async processDecrypted(msg, source) {
            // Now that its decrypted, validate the message and clean it up for consumer processing
            // Note that messages may (generally) only perform one action and we ignore remaining fields
            // after the first action.
            if (msg.flags === null) {
                msg.flags = 0;
            }
            if (msg.expireTimer === null) {
                msg.expireTimer = 0;
            }
            if (msg.flags & ns.protobuf.DataMessage.Flags.END_SESSION) {
                return msg;
            }
            if (msg.group) {
                // We should blow up here very soon. XXX
                console.error("Legacy group message detected", msg);
            }
            if (msg.attachments) {
                await Promise.all(msg.attachments.map(this.handleAttachment.bind(this)));
            }
            return msg;
        }
    };
})();
