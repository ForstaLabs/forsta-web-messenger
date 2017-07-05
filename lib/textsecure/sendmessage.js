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
        var proto         = new textsecure.protobuf.DataMessage();
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

    tryMessageAgain: function(number, encodedMessage, timestamp) {
        var proto = textsecure.protobuf.DataMessage.decode(encodedMessage);
        return this.sendIndividualProto(number, proto, timestamp);
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
        const result = await new Promise((resolve, reject) => {
            this.sendMessageProto(m.timestamp, m.recipients, m.toProto(), res => {
                res.dataMessage = m.toArrayBuffer();
                if (res.errors.length > 0) {
                    reject(res);
                } else {
                    resolve(res);
                }
            });
        });
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
        await new Promise((resolve, reject) => {
            this.sendMessageProto(m.timestamp, clone.recipients, m.toProto(), res => {
                if (res.errors.length > 0) {
                    reject(res);
                } else {
                    resolve(res);
                }
            });
        });
    },

    sendMessageProto: function(timestamp, numbers, message, callback) {
        console.assert(numbers instanceof Array);
        const outgoing = new OutgoingMessage(this.server, timestamp, numbers, message, callback);
        for (const number of numbers) {
            this.queueJobForNumber(number, () => outgoing.sendToNumber(number));
        }
    },

    sendIndividualProto: function(number, proto, timestamp) {
        return new Promise(function(resolve, reject) {
            this.sendMessageProto(timestamp, [number], proto, function(res) {
                if (res.errors.length > 0)
                    reject(res);
                else
                    resolve(res);
            });
        }.bind(this));
    },

    sendSyncMessage: function(encodedDataMessage, timestamp, destination, expirationStartTimestamp) {
        if (this.server.deviceId == 1) {
            // XXX suspect...
            console.warn("Skipping Sync Message because I am deviceId 1");
            return Promise.resolve();
        }

        var dataMessage = textsecure.protobuf.DataMessage.decode(encodedDataMessage);
        var sentMessage = new textsecure.protobuf.SyncMessage.Sent();
        sentMessage.timestamp = timestamp;
        sentMessage.message = dataMessage;
        if (destination) {
            sentMessage.destination = destination;
        }
        if (expirationStartTimestamp) {
            sentMessage.expirationStartTimestamp = expirationStartTimestamp;
        }
        var syncMessage = new textsecure.protobuf.SyncMessage();
        syncMessage.sent = sentMessage;
        var contentMessage = new textsecure.protobuf.Content();
        contentMessage.syncMessage = syncMessage;
        return this.sendIndividualProto(this.server.number, contentMessage, Date.now());
    },

    sendRequestGroupSyncMessage: function() {
        if (this.server.deviceId != 1) {
            var request = new textsecure.protobuf.SyncMessage.Request();
            request.type = textsecure.protobuf.SyncMessage.Request.Type.GROUPS;
            var syncMessage = new textsecure.protobuf.SyncMessage();
            syncMessage.request = request;
            var contentMessage = new textsecure.protobuf.Content();
            contentMessage.syncMessage = syncMessage;

            return this.sendIndividualProto(this.server.number, contentMessage, Date.now());
        } else {
            // XXX suspect...
            console.warn("Skipping Group Sync Message because I am deviceId 1");
        }
    },

    sendRequestContactSyncMessage: function() {
        if (this.server.deviceId != 1) {
            var request = new textsecure.protobuf.SyncMessage.Request();
            request.type = textsecure.protobuf.SyncMessage.Request.Type.CONTACTS;
            var syncMessage = new textsecure.protobuf.SyncMessage();
            syncMessage.request = request;
            var contentMessage = new textsecure.protobuf.Content();
            contentMessage.syncMessage = syncMessage;
            return this.sendIndividualProto(this.server.number, contentMessage, Date.now());
        } else {
            // XXX suspect...
            console.warn("Skipping Contact Sync Message because I am deviceId 1");
        }
    },

    syncReadMessages: function(reads) {
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
            return this.sendIndividualProto(this.server.number, contentMessage, Date.now());
        } else {
            // XXX suspect...
            console.warn("Skipping Read Sync Message because I am deviceId 1");
        }
    },

    sendGroupProto: async function(numbers, proto, timestamp) {
        console.assert(numbers instanceof Array);
        if (numbers.size === 1 && numbers.has(this.server.number)) {
            throw new Error('No other members in the group');
        }
        timestamp = timestamp || Date.now();
        const res = await this.sendMessageProto(timestamp, numbers, proto);
        res.dataMessage = proto.toArrayBuffer();
        if (res.errors.length > 0) {
            throw res; // Eh...  real exception would be nice.
        }
        return res;
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
        const numbers = await textsecure.store.getGroupNumbers(id);
        if (numbers === undefined) {
            throw new Error(`Unknown Group: ${id}`);
        }
        const nset = new Set(numbers);
        if (nset.size === 1 && nset.has(this.server.number)) {
            throw new Error('No other members in the group besides ourself');
        }
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

    closeSession: function(number, timestamp) {
        console.log('sending end session');
        var proto = new textsecure.protobuf.DataMessage();
        proto.body = "TERMINATE";
        proto.flags = textsecure.protobuf.DataMessage.Flags.END_SESSION;
        return this.sendIndividualProto(number, proto, timestamp).then(function(res) {
            return textsecure.store.getDeviceIds(number).then(function(deviceIds) {
                return Promise.all(deviceIds.map(function(deviceId) {
                    var address = new libsignal.SignalProtocolAddress(number, deviceId);
                    console.log('closing session for', address.toString());
                    var sessionCipher = new libsignal.SessionCipher(textsecure.store, address);
                    return sessionCipher.closeOpenSessionForDevice();
                })).then(function() {
                    return res;
                });
            });
        });
    },

    createGroup: function(numbers, name, avatar) {
        console.assert(numbers instanceof Array);
        var proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();

        return textsecure.store.createGroup(numbers).then(function(group) {
            proto.group.id = stringToArrayBuffer(group.id);
            var numbers = group.get('numbers');

            proto.group.type = textsecure.protobuf.GroupContext.Type.UPDATE;
            proto.group.members = numbers;
            proto.group.name = name;

            return this.makeAttachmentPointer(avatar).then(function(attachment) {
                proto.group.avatar = attachment;
                return this.sendGroupProto(numbers, proto).then(function() {
                    return proto.group.id;
                });
            }.bind(this));
        }.bind(this));
    },

    updateGroup: function(id, name, avatar, numbers) {
        console.assert(numbers instanceof Array);
        var proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();

        proto.group.id = stringToArrayBuffer(id);
        proto.group.type = textsecure.protobuf.GroupContext.Type.UPDATE;
        proto.group.name = name;

        return textsecure.store.addGroupNumbers(id, numbers).then(function(numbers) {
            if (numbers === undefined) {
                return Promise.reject(new Error("Unknown Group"));
            }
            proto.group.members = numbers;

            return this.makeAttachmentPointer(avatar).then(function(attachment) {
                proto.group.avatar = attachment;
                return this.sendGroupProto(numbers, proto).then(function() {
                    return proto.group.id;
                });
            }.bind(this));
        }.bind(this));
    },

    addNumberToGroup: function(id, number) {
        var proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();
        proto.group.id = stringToArrayBuffer(id);
        proto.group.type = textsecure.protobuf.GroupContext.Type.UPDATE;

        return textsecure.store.addGroupNumbers(id, [number]).then(function(numbers) {
            if (numbers === undefined)
                return Promise.reject(new Error("Unknown Group"));
            proto.group.members = numbers;

            return this.sendGroupProto(numbers, proto);
        }.bind(this));
    },

    setGroupName: async function(id, name) {
        const numbers = await textsecure.store.getGroupNumbers(id);
        console.assert(numbers instanceof Array);
        if (numbers === undefined) {
            throw new Error(`Unknown Group: ${id}`);
        }
        const proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();
        proto.group.id = stringToArrayBuffer(id);
        proto.group.type = textsecure.protobuf.GroupContext.Type.UPDATE;
        proto.group.name = name;
        proto.group.members = numbers;
        return await this.sendGroupProto(numbers, proto);
    },

    setGroupAvatar: function(id, avatar) {
        var proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();
        proto.group.id = stringToArrayBuffer(id);
        proto.group.type = textsecure.protobuf.GroupContext.Type.UPDATE;

        return textsecure.store.getGroupNumbers(id).then(function(numbers) {
            if (numbers === undefined)
                return Promise.reject(new Error("Unknown Group"));
            proto.group.members = numbers;

            return this.makeAttachmentPointer(avatar).then(function(attachment) {
                proto.group.avatar = attachment;
                return this.sendGroupProto(numbers, proto);
            }.bind(this));
        }.bind(this));
    },

    leaveGroup: function(id) {
        var proto = new textsecure.protobuf.DataMessage();
        proto.group = new textsecure.protobuf.GroupContext();
        proto.group.id = stringToArrayBuffer(id);
        proto.group.type = textsecure.protobuf.GroupContext.Type.QUIT;

        return textsecure.store.getGroupNumbers(id).then(function(numbers) {
            if (numbers === undefined)
                return Promise.reject(new Error("Unknown Group"));
            return textsecure.store.deleteGroup(id).then(function() {
                return this.sendGroupProto(numbers, proto);
            }.bind(this));
        });
    },

    sendExpirationTimerUpdateToGroup: function(id, expireTimer, timestamp) {
        return textsecure.store.getGroupNumbers(id).then(function(numbers) {
            if (numbers === undefined)
                return Promise.reject(new Error("Unknown Group"));

            const me = this.server.number;
            numbers = numbers.filter(function(number) { return number != me; });
            if (numbers.length === 0) {
                return Promise.reject(new Error('No other members in the group'));
            }
            return this.sendMessage({
                recipients: numbers,
                timestamp,
                needsSync: true,
                expireTimer: expireTimer,
                flags: textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE,
                group: {id, type: textsecure.protobuf.GroupContext.Type.DELIVER
                }
            });
        }.bind(this));
    },

    sendExpirationTimerUpdateToNumber: function(number, expireTimer, timestamp) {
        var proto = new textsecure.protobuf.DataMessage();
        return this.sendMessage({
            recipients  : [number],
            timestamp   : timestamp,
            needsSync   : true,
            expireTimer : expireTimer,
            flags       : textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE
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
