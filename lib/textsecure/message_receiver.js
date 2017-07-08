/*
 * vim: ts=4:sw=4:expandtab
 */

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
        this.socket.onopen = this.onopen.bind(this);
        console.info('Websocket connecting:', this.socket.url.split('?')[0]);
        this.wsr = new WebSocketResource(this.socket, {
            handleRequest: this.handleRequest.bind(this),
            keepalive: { path: '/v1/keepalive', disconnect: true }
        });
        this.pending = [];
    },

    close: function() {
        this.socket.close(3000, 'called close');
        delete this.listeners;
    },

    onopen: function() {
        console.info('Websocket open');
    },

    onerror: function(error) {
        console.error('Websocket error:', error);
    },

    onclose: function(ev) {
        console.warn('Websocket closed:', ev.code, ev.reason || '');
        if (ev.code === 3000) {
            return;
        }
        var eventTarget = this;
        // possible 403 or network issue. Make an request to confirm
        this.server.getDevices(this.server.number).
            then(this.connect.bind(this)). // No HTTP error? Reconnect
            catch(function(e) {
                var ev = new Event('error');
                ev.error = e;
                eventTarget.dispatchEvent(ev);
            });
    },

    handleRequest: async function(request) {
        if (request.path !== '/api/v1/message' || request.verb !== 'PUT') {
            console.error("Expected PUT /message instead of:", request);
            throw new Error('Invalid WebSocket resource received');
        }
        let envelope;
        try {
            /* We do the message decryption here, instead of in the ordered
             * pending queue to avoid exposing the time it took us to process
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
        this.queueEnvelope(envelope);
    },

    queueEnvelope: async function(envelope) {
        /* Note that despite being an async function it's not expected for the
         * caller to await this function given that they will end up waiting
         * for all work in the current queue to complete.  Many of those jobs
         * are unreleated to the caller. */
        const force_run = envelope === undefined; // We came from a setTimeout.
        if (!force_run) {
            this.pending.push(envelope);
            if (this.pending.length > 1) {
                return; // Already running
            }
        }
        while (this.pending.length) {
            /* Do not pop head until after work to signal to outside callers
             * that we are here doing work and can pickup more tasks. */
            try {
                await this.handleEnvelope(this.pending[0]);
            } catch(e) {
                /* Do not trap unknown exceptions but do insist on keeping
                 * the queue execution alive so we don't stall waiting for
                 * the next caller to wake us up again. */
                if (!(e instanceof textsecure.TextSecureError)) {
                    setTimeout(this.queueEnvelope.bind(this), 0);
                    throw e;
                }
            } finally {
                this.pending.shift();
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

    onDeliveryReceipt: function (envelope) {
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
        let promise;
        const addr = new libsignal.SignalProtocolAddress(envelope.source,
                                                         envelope.sourceDevice);
        const sessionCipher = new libsignal.SessionCipher(textsecure.store, addr);
        const envTypes = textsecure.protobuf.Envelope.Type;
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
            console.log(222, envelope);
            const ev = new Event('error');
            ev.error = e;
            ev.proto = envelope;
            this.dispatchEvent(ev);
            throw e;
        }
    },

    decryptPreKeyWhisperMessage: async function(ciphertext, sessionCipher, address) {
        try {
            this.unpad(await sessionCipher.decryptPreKeyWhisperMessage(ciphertext));
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

    handleSentMessage: async function(destination, timestamp, message, expire) {
        if (message.flags & textsecure.protobuf.DataMessage.Flags.END_SESSION) {
            await this.handleEndSession(destination);
        }
        await this.processDecrypted(message, this.server.number);
        const ev = new Event('sent');
        ev.data = {
            timestamp: timestamp.toNumber(),
            destination,
            message
        };
        if (expire) {
          ev.data.expirationStartTimestamp = expire.toNumber();
        }
        this.dispatchEvent(ev);
    },

    handleDataMessage: async function(envelope, message) {
        if (message.flags & textsecure.protobuf.DataMessage.Flags.END_SESSION) {
            await this.handleEndSession(envelope.source);
        }
        await this.processDecrypted(message, envelope.source);
        const ev = new Event('message');
        ev.data = {
            timestamp: envelope.timestamp.toNumber(),
            source: envelope.source,
            message
        };
        this.dispatchEvent(ev);
    },

    handleLegacyMessage: async function(envelope) {
        const data = await this.decrypt(envelope, envelope.legacyMessage);
        const message = textsecure.protobuf.DataMessage.decode(data);
        await this.handleDataMessage(envelope, message);
    },

    handleContentMessage: async function(envelope) {
        const data = await this.decrypt(envelope, envelope.content);
        const content = textsecure.protobuf.Content.decode(data);
        let handler;
        if (content.syncMessage) {
            await this.handleSyncMessage(envelope, content.syncMessage);
        } else if (content.dataMessage) {
            await this.handleDataMessage(envelope, content.dataMessage);
        } else {
            throw new Error('Got content message with no dataMessage or syncMessage');
        }
    },

    handleSyncMessage: async function(envelope, syncMessage) {
        if (envelope.source !== this.server.number) {
            throw new Error('Received sync message from another number');
        }
        if (envelope.sourceDevice == this.server.deviceId) {
            throw new Error('Received sync message from our own device');
        }
        if (syncMessage.sent) {
            const msg = syncMessage.sent;
            await this.handleSentMessage(msg.destination, msg.timestamp, msg.message,
                                         msg.expirationStartTimestamp);
        } else if (syncMessage.contacts) {
            await this.handleContacts(syncMessage.contacts);
        } else if (syncMessage.groups) {
            await this.handleGroups(syncMessage.groups);
        } else if (syncMessage.blocked) {
            this.handleBlocked(syncMessage.blocked);
        } else if (syncMessage.request) {
            // XXX why log here, what is this state?
            console.warn('Unhandled SyncMessage Request', syncMessage);
        } else if (syncMessage.read) {
            this.handleRead(syncMessage.read, envelope.timestamp);
        } else {
            throw new Error('Got empty SyncMessage');
        }
    },

    handleRead: function(read, timestamp) {
        for (const x of read) {
            var ev = new Event('read');
            ev.timestamp = timestamp.toNumber();
            ev.read = {
              timestamp: x.timestamp.toNumber(),
              sender: x.sender
            }
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

    handleGroups: async function(groups) {
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
                    await textsecure.store.updateGroupNumbers(groupDetails.id,
                                                              groupDetails.members);
                }
            }
            var ev = new Event('group');
            ev.groupDetails = groupDetails;
            this.dispatchEvent(ev);
            groupDetails = groupBuffer.next();
        }
        this.dispatchEvent(new Event('groupsync'));
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
                    var number = address.getName();
                    p = this.handleEndSession(number);
            }

            return p.then(function() {
                return this.processDecrypted(finalMessage);
            }.bind(this));
        }.bind(this));
    },

    handleEndSession: async function(number) {
        const deviceIds = await textsecure.store.getDeviceIds(number);
        await Promise.all(deviceIds.map(deviceId => {
            const address = new libsignal.SignalProtocolAddress(number, deviceId);
            const sessionCipher = new libsignal.SessionCipher(textsecure.store, address);
            console.warn('Closing session for', address.toString());
            return sessionCipher.closeOpenSessionForDevice();
        }));
    },

    processDecrypted: function(decrypted, source) {
        // Now that its decrypted, validate the message and clean it up for consumer processing
        // Note that messages may (generally) only perform one action and we ignore remaining fields
        // after the first action.

        if (decrypted.flags == null) {
            decrypted.flags = 0;
        }
        if (decrypted.expireTimer == null) {
            decrypted.expireTimer = 0;
        }

        if (decrypted.flags & textsecure.protobuf.DataMessage.Flags.END_SESSION) {
            decrypted.body = null;
            decrypted.attachments = [];
            decrypted.group = null;
            return Promise.resolve(decrypted);
        } else if (decrypted.flags & textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE ) {
            decrypted.body = null;
            decrypted.attachments = [];
        } else if (decrypted.flags != 0) {
            throw new Error("Unknown flags in message");
        }

        var promises = [];

        if (decrypted.group !== null) {
            decrypted.group.id = decrypted.group.id.toBinary();

            if (decrypted.group.type == textsecure.protobuf.GroupContext.Type.UPDATE) {
                if (decrypted.group.avatar !== null) {
                    promises.push(this.handleAttachment(decrypted.group.avatar));
                }
            }

            promises.push(textsecure.store.getGroupNumbers(decrypted.group.id).then(function(existingNumbers) {
                if (existingNumbers === undefined) {
                    if (decrypted.group.type != textsecure.protobuf.GroupContext.Type.UPDATE) {
                        decrypted.group.members = [source];
                        console.error("Got message for unknown group");
                    }
                    return textsecure.store.createGroup(decrypted.group.members, decrypted.group.id);
                } else {
                    var fromIndex = existingNumbers.indexOf(source);

                    if (fromIndex < 0) {
                        //TODO: This could be indication of a race...
                        console.error("Sender was not a member of the group they were sending from");
                    }

                    switch(decrypted.group.type) {
                    case textsecure.protobuf.GroupContext.Type.UPDATE:
                        return textsecure.store.updateGroupNumbers(decrypted.group.id,
                            decrypted.group.members).then(function(added) {
                            decrypted.group.added = added;

                            if (decrypted.group.avatar === null &&
                                decrypted.group.added.length == 0 &&
                                decrypted.group.name === null) {
                                return;
                            }

                            decrypted.body = null;
                            decrypted.attachments = [];
                        });

                        break;
                    case textsecure.protobuf.GroupContext.Type.QUIT:
                        decrypted.body = null;
                        decrypted.attachments = [];
                        if (source === this.server.number) {
                            return textsecure.store.deleteGroup(decrypted.group.id);
                        } else {
                            return textsecure.store.removeGroupNumbers(decrypted.group.id, [source]);
                        }
                    case textsecure.protobuf.GroupContext.Type.DELIVER:
                        decrypted.group.name = null;
                        decrypted.group.members = [];
                        decrypted.group.avatar = null;

                        break;
                    default:
                        throw new Error("Unknown group message type");
                    }
                }
            }.bind(this)));
        }

        for (var i in decrypted.attachments) {
            promises.push(this.handleAttachment(decrypted.attachments[i]));
        }

        return Promise.all(promises).then(function() {
            return decrypted;
        });
    }
});

self.textsecure = self.textsecure || {};

textsecure.MessageReceiver = function(textSecureServer, signalingKey) {
    var messageReceiver = new MessageReceiver(textSecureServer, signalingKey);
    this.addEventListener    = messageReceiver.addEventListener.bind(messageReceiver);
    this.removeEventListener = messageReceiver.removeEventListener.bind(messageReceiver);
    this.getStatus           = messageReceiver.getStatus.bind(messageReceiver);
    this.close               = messageReceiver.close.bind(messageReceiver);
    messageReceiver.connect();

    textsecure.replay.registerFunction(messageReceiver.tryMessageAgain.bind(messageReceiver), textsecure.replay.Type.INIT_SESSION);
};

textsecure.MessageReceiver.prototype = {
    constructor: textsecure.MessageReceiver
};
