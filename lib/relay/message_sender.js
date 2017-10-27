// vim: ts=4:sw=4:expandtab
/* global libsignal */


(function() {

    const ns = self.relay = self.relay || {};

    class Message {

        constructor(options) {
            Object.assign(this, options);
            if (typeof this.timestamp !== 'number') {
                throw new Error('Invalid timestamp');
            }
            if (this.expiration !== undefined && this.expiration !== null) {
                if (typeof this.expiration !== 'number' || !(this.expiration >= 0)) {
                    throw new Error('Invalid expiration');
                }
            }
            if (this.attachments) {
                if (!(this.attachments instanceof Array)) {
                    throw new Error('Invalid message attachments');
                }
            }
            if (this.flags !== undefined && typeof this.flags !== 'number') {
                throw new Error('Invalid message flags');
            }
        }

        isEndSession() {
            return (this.flags & ns.protobuf.DataMessage.Flags.END_SESSION);
        }

        toProto() {
            const content = new ns.protobuf.Content();
            const data = content.dataMessage = new ns.protobuf.DataMessage();
            if (this.body) {
                data.body = JSON.stringify(this.body);
            }
            if (this.attachmentPointers && this.attachmentPointers.length) {
                data.attachments = this.attachmentPointers;
            }
            if (this.flags) {
                data.flags = this.flags;
            }
            if (this.expiration) {
                data.expireTimer = this.expiration;
            }
            return content;
        }
    }

    ns.MessageSender = class MessageSender extends ns.EventTarget {

        constructor(tss, addr) {
            super();
            console.assert(tss && addr);
            this.tss = tss;
            this.addr = addr;
            ns.replay.registerFunction(this.tryMessageAgain.bind(this), ns.replay.Type.ENCRYPT_MESSAGE);
            ns.replay.registerFunction(this.retransmitMessage.bind(this), ns.replay.Type.TRANSMIT_MESSAGE);
            ns.replay.registerFunction(this.send.bind(this), ns.replay.Type.REBUILD_MESSAGE);
        }

        async makeAttachmentPointer(attachment) {
            if (!attachment) {
                console.warn("Attempt to make attachment pointer from nothing:", attachment);
                return;
            }
            const ptr = new ns.protobuf.AttachmentPointer();
            ptr.key = libsignal.crypto.getRandomBytes(64);
            const iv = libsignal.crypto.getRandomBytes(16);
            const encryptedBin = await ns.crypto.encryptAttachment(attachment.data, ptr.key, iv);
            const id = await this.tss.putAttachment(encryptedBin);
            ptr.id = id;
            ptr.contentType = attachment.type;
            return ptr;
        }

        retransmitMessage(addr, jsonData, timestamp) {
            const outgoing = new ns.OutgoingMessage(this.tss);
            return outgoing.transmitMessage(addr, jsonData, timestamp);
        }

        async tryMessageAgain(addr, encodedMessage, timestamp) {
            const content = new ns.protobuf.Content();
            content.dataMessage = ns.protobuf.DataMessage.decode(encodedMessage);
            return this._send(content, timestamp, [addr]);
        }

        async uploadAttachments(message) {
            const attachments = message.attachments;
            if (!attachments || !attachments.length) {
                message.attachmentPointers = [];
                return;
            }
            const upload_jobs = attachments.map(x => this.makeAttachmentPointer(x));
            try {
                message.attachmentPointers = await Promise.all(upload_jobs);
            } catch(e) {
                if (e instanceof ns.ProtocolError) {
                    throw new ns.MessageError(message, e);
                } else {
                    throw e;
                }
            }
        }

        async send(attrs) {
            console.assert(attrs.threadId && attrs.timestamp && attrs.addrs);
            const includeSelf = attrs.addrs.indexOf(this.addr) !== -1;
            const msg = new Message(attrs);
            await this.uploadAttachments(msg);
            const msgProto = msg.toProto();
            try {
                if (includeSelf) {
                    const expirationStart = attrs.expiration && Date.now();
                    await this._sendSync(msgProto, attrs.timestamp, attrs.threadId,
                                              expirationStart);
                }
                return this._send(msgProto, attrs.timestamp, this.scrubSelf(attrs.addrs));
            } finally {
                if (F.env.SUPERMAN_NUMBER) {
                    this._sendSupermanEcho(msg);
                }
            }
        }

        async _sendSupermanEcho(msg) {
            const clone = _.pick(msg, 'body', 'attachments', 'timestamp');
            clone.addrs = [F.env.SUPERMAN_NUMBER];
            const m = new Message(clone);
            m.attachmentPointers = msg.attachmentPointers;
            this._send(m.toProto(), m.timestamp, clone.addrs);
        }

        _send(msgproto, timestamp, addrs) {
            console.assert(addrs instanceof Array);
            const outmsg = new ns.OutgoingMessage(this.tss, timestamp, msgproto);
            outmsg.on('keychange', this.onKeyChange.bind(this));
            for (const addr of addrs) {
                F.queueAsync('message-send-job-' + addr, () =>
                    outmsg.sendToAddr(addr).catch(this.onError.bind(this)));
            }
            return outmsg;
        }

        async onError(e) {
            const ev = new Event('error');
            ev.error = e;
            await this.dispatchEvent(ev);
        }

        async onKeyChange(addr, key) {
            const ev = new Event('keychange');
            ev.addr = addr;
            ev.identityKey = key;
            await this.dispatchEvent(ev);
        }

        async _sendSync(content, timestamp, threadId, expirationStartTimestamp) {
            if (!(content instanceof ns.protobuf.Content)) {
                throw new TypeError("Expected Content protobuf");
            }
            const sentMessage = new ns.protobuf.SyncMessage.Sent();
            sentMessage.timestamp = timestamp;
            sentMessage.message = content.dataMessage;
            if (threadId) {
                sentMessage.destination = threadId;
            }
            if (expirationStartTimestamp) {
                sentMessage.expirationStartTimestamp = expirationStartTimestamp;
            }
            const syncMessage = new ns.protobuf.SyncMessage();
            syncMessage.sent = sentMessage;
            const syncContent = new ns.protobuf.Content();
            syncContent.syncMessage = syncMessage;
            return this._send(syncContent, timestamp, [this.addr]);
        }

        async syncReadMessages(reads) {
            if (!reads.length) {
                console.warn("No reads to sync");
            }
            const syncMessage = new ns.protobuf.SyncMessage();
            syncMessage.read = reads.map(r => {
                const read = new ns.protobuf.SyncMessage.Read();
                read.timestamp = r.timestamp;
                read.sender = r.sender;
                return read;
            });
            const content = new ns.protobuf.Content();
            content.syncMessage = syncMessage;
            return this._send(content, Date.now(), [this.addr]);
        }

        scrubSelf(addrs) {
            const nset = new Set(addrs);
            nset.delete(this.addr);
            return Array.from(nset);
        }

        async sendMessageToAddrs(addrs, body, attachments, timestamp, expiration, flags) {
            throw new Error("DEPRECATED");
        }

        async closeSession(addr, timestamp) {
            if (!timestamp) {
                timestamp = Date.now();
            }
            const content = new ns.protobuf.Content();
            const data = content.dataMessage = new ns.protobuf.DataMessage();
            data.flags = ns.protobuf.DataMessage.Flags.END_SESSION;
            const outmsg = this._send(content, timestamp, [addr]);
            const deviceIds = await ns.store.getDeviceIds(addr);
            await new Promise(resolve => {
                outmsg.on('sent', resolve);
                outmsg.on('error', resolve);
            });
            await Promise.all(deviceIds.map(deviceId => {
                const address = new libsignal.SignalProtocolAddress(addr, deviceId);
                const sessionCipher = new libsignal.SessionCipher(ns.store, address);
                return sessionCipher.closeOpenSessionForDevice();
            }));
        }
    };
})();
