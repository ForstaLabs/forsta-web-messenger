// vim: ts=4:sw=4:expandtab


(function() {

    const ns = self.textsecure = self.textsecure || {};

    class Message {

        constructor(options) {
            Object.assign(this, options);
            if (!(this.recipients instanceof Array)) {
                throw new Error('Invalid recipient list');
            }
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
            if ((typeof this.timestamp !== 'number') ||
                (this.body && typeof this.body !== 'string')) {
                throw new Error('Invalid message body');
            }
        }

        isEndSession() {
            return (this.flags & ns.protobuf.DataMessage.Flags.END_SESSION);
        }

        toProto() {
            const content = new ns.protobuf.Content();
            const data = content.dataMessage = new ns.protobuf.DataMessage();
            if (this.body) {
                data.body = this.body;
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

        toArrayBuffer() {
            return this.toProto().toArrayBuffer();
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
            ns.replay.registerFunction(this.sendMessage.bind(this), ns.replay.Type.REBUILD_MESSAGE);
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
            var outgoing = new F.OutgoingMessage(this.tss);
            return outgoing.transmitMessage(addr, jsonData, timestamp);
        }

        async tryMessageAgain(addr, encodedMessage, timestamp) {
            const content = new ns.protobuf.Content();
            content.dataMessage = ns.protobuf.DataMessage.decode(encodedMessage);
            return this.sendMessageProto(timestamp, [addr], content);
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

        async sendMessage(attrs) {
            const m = new Message(attrs);
            await this.uploadAttachments(m);
            try {
                return this.sendMessageProto(m.timestamp, m.recipients, m.toProto());
            } finally {
                if (F.env.SUPERMAN_NUMBER) {
                    this.sendSupermanEcho(m);
                }
            }
        }

        async sendSupermanEcho(msg) {
            const clone = _.pick(msg, 'body', 'attachments', 'timestamp');
            clone.recipients = [F.env.SUPERMAN_NUMBER];
            const m = new Message(clone);
            m.attachmentPointers = msg.attachmentPointers;
            this.sendMessageProto(m.timestamp, clone.recipients, m.toProto());
        }

        sendMessageProto(timestamp, addrs, msgproto) {
            console.assert(addrs instanceof Array);
            const outmsg = new F.OutgoingMessage(this.tss, timestamp, msgproto);
            outmsg.on('keychange', this.onKeyChange.bind(this));
            for (const addr of addrs) {
                F.queueAsync('message-send-job-' + addr, () => outmsg.sendToAddr(addr));
            }
            return outmsg;
        }

        async onKeyChange(addr, key) {
            const ev = new Event('keychange');
            ev.addr = addr;
            ev.identityKey = key;
            await this.dispatchEvent(ev);
        }

        async sendSyncMessage(content, timestamp, threadId, expirationStartTimestamp) {
            if (!(content instanceof ns.protobuf.Content)) {
                content = ns.protobuf.Content.decode(content);
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
            // Originally this sent the sync message with a unique timestamp on the envelope but this
            // led to consistency problems with Android clients that were using that timestamp for delivery
            // receipts.  It's hard to say what the correct behavior is given that sync messages could
            // be cataloged separately and might want their own timestamps (which are the index for receipts).
            return this.sendMessageProto(timestamp, [this.addr], syncContent);
            //return this.sendMessageProto(Date.now(), [this.addr], syncContent);
        }

        async _sendRequestSyncMessage(type) {
            const request = new ns.protobuf.SyncMessage.Request();
            request.type = type;
            const syncMessage = new ns.protobuf.SyncMessage();
            syncMessage.request = request;
            const content = new ns.protobuf.Content();
            content.syncMessage = syncMessage;
            return this.sendMessageProto(Date.now(), [this.addr], content);
        }

        async syncReadMessages(reads) {
            const syncMessage = new ns.protobuf.SyncMessage();
            syncMessage.read = reads.map(r => {
                const read = new ns.protobuf.SyncMessage.Read();
                read.timestamp = r.timestamp;
                read.sender = r.sender;
                return read;
            });
            const content = new ns.protobuf.Content();
            content.syncMessage = syncMessage;
            return this.sendMessageProto(Date.now(), [this.addr], content);
        }

        scrubSelf(addrs) {
            const nset = new Set(addrs);
            nset.delete(this.addr);
            return Array.from(nset);
        }

        async sendMessageToAddrs(addrs, body, attachments, timestamp, expiration, flags) {
            console.assert(body instanceof Array);
            return await this.sendMessage({
                recipients: this.scrubSelf(addrs),
                body: JSON.stringify(body),
                timestamp,
                attachments,
                expiration,
                flags
            });
        }

        async closeSession(addr, timestamp) {
            if (!timestamp) {
                timestamp = Date.now();
            }
            const content = new ns.protobuf.Content();
            const data = content.dataMessage = new ns.protobuf.DataMessage();
            data.flags = ns.protobuf.DataMessage.Flags.END_SESSION;
            const outmsg = this.sendMessageProto(timestamp, [addr], content);
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
