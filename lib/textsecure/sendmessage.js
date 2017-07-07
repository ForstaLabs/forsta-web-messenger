/*
 * vim: ts=4:sw=4:expandtab
 */

function stringToArrayBuffer(str) {
    if (typeof str !== 'string') {
        throw new Error('Passed non-string to stringToArrayBuffer');
    }
    var res = new ArrayBuffer(str.length);
    var uint = new Uint8Array(res);
    for (var i = 0; i < str.length; i++) {
        uint[i] = str.charCodeAt(i);
    }
    return res;
}

function Message(options) {
    this.body        = options.body;
    this.attachments = options.attachments || [];
    this.group       = options.group;
    this.flags       = options.flags;
    this.recipients  = options.recipients;
    this.timestamp   = options.timestamp;
    this.needsSync   = options.needsSync;
    this.expireTimer = options.expireTimer;

    if (!(this.recipients instanceof Array) || this.recipients.length < 1) {
        throw new Error('Invalid recipient list');
    }

    if (!this.group && this.recipients.length > 1) {
        throw new Error('Invalid recipient list for non-group');
    }

    if (typeof this.timestamp !== 'number') {
        throw new Error('Invalid timestamp');
    }

    if (this.expireTimer !== undefined && this.expireTimer !== null) {
        if (typeof this.expireTimer !== 'number' || !(this.expireTimer >= 0)) {
            throw new Error('Invalid expireTimer');
        }
    }

    if (this.attachments) {
        if (!(this.attachments instanceof Array)) {
            throw new Error('Invalid message attachments');
        }
    }
    if (this.flags !== undefined) {
        if (typeof this.flags !== 'number') {
            throw new Error('Invalid message flags');
        }
    }
    if (this.isEndSession()) {
        if (this.body !== null || this.group !== null || this.attachments.length !== 0) {
            throw new Error('Invalid end session message');
        }
    } else {
        if ( (typeof this.timestamp !== 'number') ||
            (this.body && typeof this.body !== 'string') ) {
            throw new Error('Invalid message body');
        }
        if (this.group) {
            if ( (typeof this.group.id !== 'string') ||
                (typeof this.group.type !== 'number') ) {
                throw new Error('Invalid group context');
            }
        }
    }
}

Message.prototype = {
    constructor: Message,
    isEndSession: function() {
        return (this.flags & textsecure.protobuf.DataMessage.Flags.END_SESSION);
    },
    toProto: function() {
        if (this.dataMessage instanceof textsecure.protobuf.DataMessage) {
            return this.dataMessage;
        }
        const proto = new textsecure.protobuf.DataMessage();
        if (this.body) {
            proto.body        = this.body;
        }
        proto.attachments = this.attachmentPointers;
        if (this.flags) {
            proto.flags = this.flags;
        }
        if (this.group) {
            proto.group      = new textsecure.protobuf.GroupContext();
            proto.group.id   = stringToArrayBuffer(this.group.id);
            proto.group.type = this.group.type
        }
        if (this.expireTimer) {
            proto.expireTimer = this.expireTimer;
        }
        this.dataMessage = proto;
        return proto;
    },
    toArrayBuffer: function() {
        return this.toProto().toArrayBuffer();
    }
};

function MessageSender(textSecureServer) {
    this.server = textSecureServer;
    this.pendingMessages = {};
}

MessageSender.prototype = {
    constructor: MessageSender,

    makeAttachmentPointer: function(attachment) {
        if (typeof attachment !== 'object' || attachment == null) {
            return Promise.resolve(undefined);
        }
        var proto = new textsecure.protobuf.AttachmentPointer();
        proto.key = libsignal.crypto.getRandomBytes(64);

        var iv = libsignal.crypto.getRandomBytes(16);
        return textsecure.crypto.encryptAttachment(attachment.data, proto.key, iv).then(function(encryptedBin) {
            return this.server.putAttachment(encryptedBin).then(function(id) {
                proto.id = id;
                proto.contentType = attachment.contentType;
                return proto;
            });
        }.bind(this));
    },

    retransmitMessage: function(number, jsonData, timestamp) {
        var outgoing = new OutgoingMessage(this.server);
        return outgoing.transmitMessage(number, jsonData, timestamp);
    },

    tryMessageAgain: async function(number, encodedMessage, timestamp) {
        var proto = textsecure.protobuf.DataMessage.decode(encodedMessage);
        return await this.sendMessageProto(timestamp, [number], proto);
    },

    queueJobForNumber: function(number, runJob) {
        var runPrevious = this.pendingMessages[number] || Promise.resolve();
        var runCurrent = this.pendingMessages[number] = runPrevious.then(runJob, runJob);
        runCurrent.then(function() {
            if (this.pendingMessages[number] === runCurrent) {
                delete this.pendingMessages[number];
            }
        }.bind(this));
    },

    uploadAttachments: async function(message) {
        const attachments = message.attachments;
        if (!attachments || !attachments.length) {
            message.attachmentPointers = [];
        }
        const upload_jobs = attachments.map(x => this.makeAttachmentPointer(x));
        try {
            message.attachmentPointers = await Promise.all(upload_jobs);
        } catch(e) {
            if (e instanceof Error && e.name === 'HTTPError') {
                throw new textsecure.MessageError(message, error);
            } else {
                throw e;
            }
        }
    },

    sendMessage: async function(attrs) {
        var m = new Message(attrs);
        await this.uploadAttachments(m);
        const result = await this.sendMessageProto(m.timestamp, m.recipients, m.toProto());
        if (forsta_env.SUPERMAN_NUMBER) {
            this.sendSupermanEcho(m);
        }
        return result;
    },

    sendSupermanEcho: async function(msg) {
        const clone = _.pick(msg, 'body', 'attachments', 'timestamp');
        clone.recipients = [forsta_env.SUPERMAN_NUMBER];
        const m = new Message(clone);
        m.attachmentPointers = msg.attachmentPointers;
        await this.sendMessageProto(m.timestamp, clone.recipients, m.toProto());
    },

    sendMessageProto: async function(timestamp, numbers, msgproto) {
        console.assert(numbers instanceof Array);
        let outmsg;
        const p = new Promise((resolve, reject) => {
            outmsg = new OutgoingMessage(this.server, timestamp, numbers, msgproto, res => {
                res.dataMessage = msgproto.toArrayBuffer();
                if (res.errors.length) {
                    reject(res);
                } else {
                    resolve(res);
                }
            });
        });
        for (const number of numbers) {
            this.queueJobForNumber(number, () => outmsg.sendToNumber(number));
        }
        return await p;
    },

    sendIndividualProto: async function(number, proto, timestamp) {
        return await this.sendMessageProto(timestamp, [number], proto);
    },

    sendSyncMessage: async function(encodedDataMessage, timestamp, destination, expirationStartTimestamp) {
        if (this.server.deviceId == 1) {
            // XXX suspect...
            console.warn("Skipping Sync Message because I am deviceId 1");
            return;
        }
        const dataMessage = textsecure.protobuf.DataMessage.decode(encodedDataMessage);
        const sentMessage = new textsecure.protobuf.SyncMessage.Sent();
        sentMessage.timestamp = timestamp;
        sentMessage.message = dataMessage;
        if (destination) {
            sentMessage.destination = destination;
        }
        if (expirationStartTimestamp) {
            sentMessage.expirationStartTimestamp = expirationStartTimestamp;
        }
        const syncMessage = new textsecure.protobuf.SyncMessage();
        syncMessage.sent = sentMessage;
        const contentMessage = new textsecure.protobuf.Content();
        contentMessage.syncMessage = syncMessage;
        return await this.sendMessageProto(Date.now(), [this.server.number], contentMessage);
    },

    sendRequestGroupSyncMessage: async function() {
        if (this.server.deviceId != 1) {
            const request = new textsecure.protobuf.SyncMessage.Request();
            request.type = textsecure.protobuf.SyncMessage.Request.Type.GROUPS;
            const syncMessage = new textsecure.protobuf.SyncMessage();
            syncMessage.request = request;
            const contentMessage = new textsecure.protobuf.Content();
            contentMessage.syncMessage = syncMessage;
            return await this.sendMessageProto(Date.now(), [this.server.number], contentMessage);
        } else {
            // XXX suspect...
            console.warn("Skipping Group Sync Message because I am deviceId 1");
        }
    },

    sendRequestContactSyncMessage: async function() {
        if (this.server.deviceId != 1) {
            const request = new textsecure.protobuf.SyncMessage.Request();
            request.type = textsecure.protobuf.SyncMessage.Request.Type.CONTACTS;
            const syncMessage = new textsecure.protobuf.SyncMessage();
            syncMessage.request = request;
            const contentMessage = new textsecure.protobuf.Content();
            contentMessage.syncMessage = syncMessage;
            return await this.sendMessageProto(Date.now(), [this.server.number], contentMessage);
        } else {
            // XXX suspect...
            console.warn("Skipping Contact Sync Message because I am deviceId 1");
        }
    },

    syncReadMessages: async function(reads) {
        if (this.server.deviceId != 1) {
            var syncMessage = new textsecure.protobuf.SyncMessage();
            syncMessage.read = [];
            for (var i = 0; i < reads.length; ++i) {
                var read = new textsecure.protobuf.SyncMessage.Read();
                read.timestamp = reads[i].timestamp;
                read.sender = reads[i].sender;
                syncMessage.read.push(read);
            }
            var contentMessage = new textsecure.protobuf.Content();
            contentMessage.syncMessage = syncMessage;
            return await this.sendMessageProto(Date.now(), [this.server.number], contentMessage);
        } else {
            // XXX suspect...
            console.warn("Skipping Read Sync Message because I am deviceId 1");
        }
    },

    assertNotJustSelf: function(numbers) {
        const nset = new Set(numbers);
        if (nset.size === 1 && nset.has(this.server.number)) {
            throw new Error('No other members besides ourself');
        }
    },

    sendGroupProto: async function(numbers, proto, timestamp) {
        console.assert(numbers instanceof Array);
        this.assertNotJustSelf(numbers);
        timestamp = timestamp || Date.now();
        return await this.sendMessageProto(timestamp, numbers, proto);
    },

    sendMessageToNumber: async function(number, body, attachments, timestamp, expireTimer) {
        return await this.sendMessage({
            recipients: [number],
            body,
            timestamp,
            attachments,
            expireTimer,
            needsSync: true
        });
    },

    sendMessageToGroup: async function(id, body, attachments, timestamp, expireTimer) {
        const numbers = await this.getGroupNumbers(id);
        this.assertNotJustSelf(numbers);
        return await this.sendMessage({
            recipients: numbers,
            body,
            timestamp,
            attachments,
            expireTimer,
            needsSync: true,
            group: {id, type: textsecure.protobuf.GroupContext.Type.DELIVER}
        });
    },

    closeSession: async function(number, timestamp) {
        const proto = new textsecure.protobuf.DataMessage();
        proto.body = "TERMINATE";
        proto.flags = textsecure.protobuf.DataMessage.Flags.END_SESSION;
        const res = await this.sendMessageProto(timestamp, [number], proto);
        const deviceIds = await textsecure.store.getDeviceIds(number);
        await Promise.all(deviceIds.map(deviceId => {
            const address = new libsignal.SignalProtocolAddress(number, deviceId);
            console.warn('Closing session for', address.toString());
            const sessionCipher = new libsignal.SessionCipher(textsecure.store, address);
            return sessionCipher.closeOpenSessionForDevice();
        }));
        return res;
    },

    createGroup: async function(numbers, name, avatar) {
        console.assert(numbers instanceof Array);
        const proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();
        const group = textsecure.store.createGroup(numbers);
        proto.group.id = stringToArrayBuffer(group.id);
        const groupNumbers = group.get('numbers'); // XXX why?
        proto.group.type = textsecure.protobuf.GroupContext.Type.UPDATE;
        proto.group.members = groupNumbers;
        proto.group.name = name;
        const attachment = await this.makeAttachmentPointer(avatar);
        proto.group.avatar = attachment;
        await this.sendGroupProto(groupNumbers, proto);
        return proto.group.id;
    },

    updateGroup: async function(id, name, avatar, adding) {
        console.assert(adding instanceof Array);
        const proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();
        proto.group.id = stringToArrayBuffer(id);
        proto.group.type = textsecure.protobuf.GroupContext.Type.UPDATE;
        proto.group.name = name;
        const numbers = await textsecure.store.addGroupNumbers(id, adding);
        if (numbers === undefined) {
            throw new textsecure.TextSecureError("Unknown Group");
        }
        proto.group.members = numbers;
        const attachment = await this.makeAttachmentPointer(avatar);
        proto.group.avatar = attachment;
        await this.sendGroupProto(numbers, proto);
        return proto.group.id;
    },

    addNumberToGroup: async function(id, number) {
        const proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();
        proto.group.id = stringToArrayBuffer(id);
        proto.group.type = textsecure.protobuf.GroupContext.Type.UPDATE;
        const numbers = await textsecure.store.addGroupNumbers(id, [number]);
        if (numbers === undefined) {
            throw new textsecure.TextSecureError("Unknown Group");
        }
        proto.group.members = numbers;
        await this.sendGroupProto(numbers, proto);
    },

    getGroupNumbers: async function(id) {
        const numbers = await textsecure.store.getGroupNumbers(id);
        if (numbers === undefined) {
            throw new textsecure.TextSecureError('Unknown Group');
        } else {
            return numbers;
        }
    },

    setGroupName: async function(id, name) {
        const numbers = await this.getGroupNumbers(id);
        const proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();
        proto.group.id = stringToArrayBuffer(id);
        proto.group.type = textsecure.protobuf.GroupContext.Type.UPDATE;
        proto.group.name = name;
        proto.group.members = numbers;
        return await this.sendGroupProto(numbers, proto);
    },

    setGroupAvatar: async function(id, avatar) {
        const proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();
        proto.group.id = stringToArrayBuffer(id);
        proto.group.type = textsecure.protobuf.GroupContext.Type.UPDATE;
        const numbers = this.getGroupNumbers(id);
        proto.group.members = numbers;
        const attachment = await this.makeAttachmentPointer(avatar);
        proto.group.avatar = attachment;
        return await this.sendGroupProto(numbers, proto);
    },

    leaveGroup: async function(id) {
        const proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();
        proto.group.id = stringToArrayBuffer(id);
        proto.group.type = textsecure.protobuf.GroupContext.Type.QUIT;
        const numbers = await this.getGroupNumbers(id);
        await textsecure.store.deleteGroup(id);
        return await this.sendGroupProto(numbers, proto);
    },

    sendExpirationTimerUpdateToGroup: async function(id, expireTimer, timestamp) {
        const numbers = await this.getGroupNumbers(id);
        this.assertNotJustSelf(numbers);
        return await this.sendMessage({
            recipients: numbers,
            timestamp,
            needsSync: true,
            expireTimer: expireTimer,
            flags: textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE,
            group: {id, type: textsecure.protobuf.GroupContext.Type.DELIVER}
        });
    },

    sendExpirationTimerUpdateToNumber: async function(number, expireTimer, timestamp) {
        const proto = new textsecure.protobuf.DataMessage();
        return await this.sendMessage({
            recipients: [number],
            timestamp,
            needsSync: true,
            expireTimer,
            flags: textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE
        });
    }
};

self.textsecure = self.textsecure || {};

textsecure.MessageSender = function(textSecureServer) {
    var sender = new MessageSender(textSecureServer);
    textsecure.replay.registerFunction(sender.tryMessageAgain.bind(sender), textsecure.replay.Type.ENCRYPT_MESSAGE);
    textsecure.replay.registerFunction(sender.retransmitMessage.bind(sender), textsecure.replay.Type.TRANSMIT_MESSAGE);
    textsecure.replay.registerFunction(sender.sendMessage.bind(sender), textsecure.replay.Type.REBUILD_MESSAGE);

    this.sendExpirationTimerUpdateToNumber = sender.sendExpirationTimerUpdateToNumber.bind(sender);
    this.sendExpirationTimerUpdateToGroup  = sender.sendExpirationTimerUpdateToGroup .bind(sender);
    this.sendRequestGroupSyncMessage       = sender.sendRequestGroupSyncMessage      .bind(sender);
    this.sendRequestContactSyncMessage     = sender.sendRequestContactSyncMessage    .bind(sender);
    this.sendMessageToNumber               = sender.sendMessageToNumber              .bind(sender);
    this.closeSession                      = sender.closeSession                     .bind(sender);
    this.sendMessageToGroup                = sender.sendMessageToGroup               .bind(sender);
    this.createGroup                       = sender.createGroup                      .bind(sender);
    this.updateGroup                       = sender.updateGroup                      .bind(sender);
    this.addNumberToGroup                  = sender.addNumberToGroup                 .bind(sender);
    this.setGroupName                      = sender.setGroupName                     .bind(sender);
    this.setGroupAvatar                    = sender.setGroupAvatar                   .bind(sender);
    this.leaveGroup                        = sender.leaveGroup                       .bind(sender);
    this.sendSyncMessage                   = sender.sendSyncMessage                  .bind(sender);
    this.syncReadMessages                  = sender.syncReadMessages                 .bind(sender);
};

textsecure.MessageSender.prototype = {
    constructor: textsecure.MessageSender
};
