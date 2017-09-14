// vim: ts=4:sw=4:expandtab
/* global dcodeIO */

function stringToArrayBuffer(str) {
    if (typeof str !== 'string') {
        throw new Error('Passed non-string to stringToArrayBuffer');
    }
    const res = new ArrayBuffer(str.length);
    const uint = new Uint8Array(res);
    for (let i = 0; i < str.length; i++) {
        uint[i] = str.charCodeAt(i);
    }
    return res;
}

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
        if (this.group) {
            throw new Error('Deprecated group usage');
        }
    }

    isEndSession() {
        return (this.flags & textsecure.protobuf.DataMessage.Flags.END_SESSION);
    }

    toProto() {
        const content = new textsecure.protobuf.Content();
        const data = content.dataMessage = new textsecure.protobuf.DataMessage();
        if (this.body) {
            data.body = this.body;
        }
        if (this.attachmentPointers && this.attachmentPointers.length) {
            data.attachments = this.attachmentPointers;
        }
        if (this.flags) {
            data.flags = this.flags;
        }
        if (this.group) {
            throw new Error('Deprecated group usage');
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

function MessageSender(textSecureServer) {
    this.server = textSecureServer;
}

MessageSender.prototype = {
    constructor: MessageSender,

    makeAttachmentPointer: async function(attachment) {
        if (!attachment) {
            console.warn("Attempt to make attachment pointer from nothing:", attachment);
            return;
        }
        const ptr = new textsecure.protobuf.AttachmentPointer();
        ptr.key = libsignal.crypto.getRandomBytes(64);
        const iv = libsignal.crypto.getRandomBytes(16);
        const encryptedBin = await textsecure.crypto.encryptAttachment(attachment.data, ptr.key, iv);
        const id = await this.server.putAttachment(encryptedBin);
        ptr.id = id;
        ptr.contentType = attachment.type;
        return ptr;
    },

    retransmitMessage: function(addr, jsonData, timestamp) {
        var outgoing = new F.OutgoingMessage(this.server);
        return outgoing.transmitMessage(addr, jsonData, timestamp);
    },

    tryMessageAgain: async function(addr, encodedMessage, timestamp) {
        const content = new textsecure.protobuf.Content();
        content.dataMessage = textsecure.protobuf.DataMessage.decode(encodedMessage);
        return this.sendMessageProto(timestamp, [addr], content);
    },

    uploadAttachments: async function(message) {
        const attachments = message.attachments;
        if (!attachments || !attachments.length) {
            message.attachmentPointers = [];
            return;
        }
        const upload_jobs = attachments.map(x => this.makeAttachmentPointer(x));
        try {
            message.attachmentPointers = await Promise.all(upload_jobs);
        } catch(e) {
            if (e instanceof Error && e.name === 'HTTPError') {
                throw new textsecure.MessageError(message, e);
            } else {
                throw e;
            }
        }
    },

    sendMessage: async function(attrs) {
        const m = new Message(attrs);
        await this.uploadAttachments(m);
        try {
            return this.sendMessageProto(m.timestamp, m.recipients, m.toProto());
        } finally {
            if (F.env.SUPERMAN_NUMBER) {
                this.sendSupermanEcho(m);
            }
        }
    },

    sendSupermanEcho: async function(msg) {
        const clone = _.pick(msg, 'body', 'attachments', 'timestamp');
        clone.recipients = [F.env.SUPERMAN_NUMBER];
        const m = new Message(clone);
        m.attachmentPointers = msg.attachmentPointers;
        this.sendMessageProto(m.timestamp, clone.recipients, m.toProto());
    },

    sendMessageProto: function(timestamp, addrs, msgproto) {
        console.assert(addrs instanceof Array);
        const outmsg = new F.OutgoingMessage(this.server, timestamp, msgproto);
        for (const addr of addrs) {
            F.queueAsync('message-send-job-' + addr, () => outmsg.sendToAddr(addr));
        }
        return outmsg;
    },

    sendSyncMessage: async function(content, timestamp, threadId, expirationStartTimestamp) {
        if (!(content instanceof textsecure.protobuf.Content)) {
            content = textsecure.protobuf.Content.decode(content);
        }
        const sentMessage = new textsecure.protobuf.SyncMessage.Sent();
        sentMessage.timestamp = timestamp;
        sentMessage.message = content.dataMessage;
        if (threadId) {
            sentMessage.destination = threadId;
        }
        if (expirationStartTimestamp) {
            sentMessage.expirationStartTimestamp = expirationStartTimestamp;
        }
        const syncMessage = new textsecure.protobuf.SyncMessage();
        syncMessage.sent = sentMessage;
        const syncContent = new textsecure.protobuf.Content();
        syncContent.syncMessage = syncMessage;
        // Originally this sent the sync message with a unique timestamp on the envelope but this
        // led to consistency problems with Android clients that were using that timestamp for delivery
        // receipts.  It's hard to say what the correct behavior is given that sync messages could
        // be cataloged separately and might want their own timestamps (which are the index for receipts).
        return this.sendMessageProto(timestamp, [this.server.addr], syncContent);
        //return this.sendMessageProto(Date.now(), [this.server.addr], syncContent);
    },

    _sendRequestSyncMessage: async function(type) {
        const request = new textsecure.protobuf.SyncMessage.Request();
        request.type = type;
        const syncMessage = new textsecure.protobuf.SyncMessage();
        syncMessage.request = request;
        const content = new textsecure.protobuf.Content();
        content.syncMessage = syncMessage;
        return this.sendMessageProto(Date.now(), [this.server.addr], content);
    },

    sendRequestGroupSyncMessage: async function() {
        const type = textsecure.protobuf.SyncMessage.Request.Type.GROUPS;
        return await this._sendRequestSyncMessage(type);
    },

    syncReadMessages: async function(reads) {
        const syncMessage = new textsecure.protobuf.SyncMessage();
        syncMessage.read = reads.map(r => {
            const read = new textsecure.protobuf.SyncMessage.Read();
            read.timestamp = r.timestamp;
            read.sender = r.sender;
            return read;
        });
        const content = new textsecure.protobuf.Content();
        content.syncMessage = syncMessage;
        return this.sendMessageProto(Date.now(), [this.server.addr], content);
    },

    scrubSelf: function(addrs) {
        const nset = new Set(addrs);
        nset.delete(this.server.addr);
        return Array.from(nset);
    },

    sendMessageToAddrs: async function(addrs, body, attachments, timestamp, expiration) {
        console.assert(body instanceof Array);
        return await this.sendMessage({
            recipients: this.scrubSelf(addrs),
            body: JSON.stringify(body),
            timestamp,
            attachments,
            expiration,
            needsSync: true
        });
    },

    closeSession: async function(addr, timestamp) {
        const content = new textsecure.protobuf.Content();
        const data = content.dataMessage = new textsecure.protobuf.DataMessage();
        data.flags = textsecure.protobuf.DataMessage.Flags.END_SESSION;
        const outmsg = this.sendMessageProto(timestamp, [addr], content);
        const deviceIds = await textsecure.store.getDeviceIds(addr);
        await new Promise(resolve => {
            outmsg.on('complete', resolve);
            outmsg.on('error', resolve);
        });
        await Promise.all(deviceIds.map(deviceId => {
            const address = new libsignal.SignalProtocolAddress(addr, deviceId);
            const sessionCipher = new libsignal.SessionCipher(textsecure.store, address);
            return sessionCipher.closeOpenSessionForDevice();
        }));
    },

    sendExpirationUpdateToAddrs: async function(addrs, expiration, timestamp) {
        return await this.sendMessage({
            recipients: this.scrubSelf(addrs),
            timestamp,
            needsSync: true,
            expiration,
            flags: textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE
        });
    },

    sendGroups: async function(groupsData, extraData) {
        const blob = new dcodeIO.ByteBuffer();
        /* The groups "blob" is binary data with a 32bit size indicator between GroupDetail
         * and/or Attachment buffers.  The size indicates how big the next buffer is. If
         * the buffer is a GroupDetail has an avatar ptr the avatar buffer itself must directly
         * follow the GroupDetail it pertains to.  There is no size header in this case.  The
         * size must be read from the GroupDetail attachmentpointer for the avatar.  See
         * content_parser.js for more details of decoding this. */
        for (const g of groupsData) {
            const groupDetails = new textsecure.protobuf.GroupDetails();
            groupDetails.name = g.name;
            groupDetails.members = g.members;
            groupDetails.id = stringToArrayBuffer(g.id);
            const buf = groupDetails.toArrayBuffer();
            blob.writeVarint32(buf.byteLength);
            blob.append(buf);
        }
        const groups = new textsecure.protobuf.SyncMessage.Groups();
        blob.limit = 0; // Use inverse range technique toArrayBuffer.
        groups.blob = await this.makeAttachmentPointer({
            data: blob.toArrayBuffer(),
            type: ''
        });
        const content = new textsecure.protobuf.Content();
        const syncMessage = new textsecure.protobuf.SyncMessage();
        syncMessage.groups = groups;
        content.syncMessage = syncMessage;
        // Disabled for now, this causes the android app to show a content message.
        //const dataMessage = new textsecure.protobuf.DataMessage();
        //dataMessage.body = JSON.stringify(extraData);
        //content.dataMessage = dataMessage;
        return this.sendMessageProto(Date.now(), [this.server.addr], content);
    }
};

self.textsecure = self.textsecure || {};

textsecure.MessageSender = function(textSecureServer) {
    const sender = new MessageSender(textSecureServer);
    textsecure.replay.registerFunction(sender.tryMessageAgain.bind(sender), textsecure.replay.Type.ENCRYPT_MESSAGE);
    textsecure.replay.registerFunction(sender.retransmitMessage.bind(sender), textsecure.replay.Type.TRANSMIT_MESSAGE);
    textsecure.replay.registerFunction(sender.sendMessage.bind(sender), textsecure.replay.Type.REBUILD_MESSAGE);
    this.sendExpirationUpdateToAddrs = sender.sendExpirationUpdateToAddrs.bind(sender);
    this.sendRequestGroupSyncMessage = sender.sendRequestGroupSyncMessage.bind(sender);
    this.sendMessageToAddrs = sender.sendMessageToAddrs.bind(sender);
    this.closeSession = sender.closeSession.bind(sender);
    this.sendSyncMessage = sender.sendSyncMessage.bind(sender);
    this.syncReadMessages = sender.syncReadMessages.bind(sender);
};

textsecure.MessageSender.prototype = {
    constructor: textsecure.MessageSender
};
