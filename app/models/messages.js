/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.Message = Backbone.Model.extend({
        database: F.Database,
        storeName: 'messages',

        initialize: function() {
            this.conversations = F.foundation.getConversations();
            this.on('change:attachments', this.updateImageUrl);
            this.on('destroy', this.revokeImageUrl);
            this.on('change:expirationStartTimestamp', this.setToExpire);
            this.on('change:expireTimer', this.setToExpire);
            this.setToExpire();
        },

        defaults  : function() {
            return {
                timestamp: new Date().getTime(),
                attachments: []
            };
        },

        validate: function(attrs, options) {
            const required = [
                'conversationId',
                'received_at',
                'sent_at'
            ];
            const missing = _.filter(required, x => attrs[x] === undefined);
            if (missing.length) {
                return new Error("Message missing attributes: " + missing);
            }
            if (attrs.html) {
                /* Augment the model with a safe version of html so we don't have to
                 * rerender every message on every convo view. */
                console.warn("Scrubing html!!!", !!this.safe_html, !!this.html, this.html === attrs.html, this);
                const safe = F.util.htmlSanitize(attrs.html);
                this.safe_html = F.emoji.replace_unified(safe);
            }
        },

        isEndSession: function() {
            var flag = textsecure.protobuf.DataMessage.Flags.END_SESSION;
            return !!(this.get('flags') & flag);
        },

        isExpirationTimerUpdate: function() {
            const expire = textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE;
            return !!(this.get('flags') & expire);
        },

        isGroupUpdate: function() {
            return !!(this.get('group_update'));
        },

        isIncoming: function() {
            return this.get('type') === 'incoming';
        },

        isClientOnly: function() {
            return this.get('type') === 'clientOnly';
        },

        isUnread: function() {
            return !!this.get('unread');
        },

        getMeta: function() {
            const meta = [];
            if (this.isGroupUpdate()) {
                const group_update = this.get('group_update');
                if (group_update.left) {
                    const left = group_update.left.map(this.getUserByAddr.bind(this));
                    meta.push(left.map(u => u.getName()).join(', ') + ' left the conversation');
                }
                if (group_update.name) {
                    meta.push(`Conversation title changed to "${group_update.name}"`);
                }
                if (group_update.joined) {
                    const joined = group_update.joined.map(this.getUserByAddr.bind(this));
                    meta.push(joined.map(u => u.getName()).join(', ') + ' joined the conversation');
                }
            }
            if (this.isEndSession()) {
                meta.push('Secure session reset');
            }
            if (this.isIncoming() && this.hasKeyConflicts()) {
                meta.push('Received message with unknown identity key');
            }
            if (this.isExpirationTimerUpdate()) {
                const t = this.get('expirationTimerUpdate').expireTimer;
                if (t) {
                    const human_time = F.tpl.help.humantime(t);
                    meta.push(`Message expiration set to ${human_time}`);
                } else {
                    meta.push('Message expiration turned off');
                }
            }
            if (this.get('type') === 'keychange') {
                // XXX might be double coverage with hasKeyConflicts...
                meta.push('Identity key changed');
            }
            const att = this.get('attachments');
            if (att.length === 1) {
                const fields = [];
                const a = att[0];
                if (a.name && a.name.length) {
                    fields.push(a.name);
                } else if (a.type && a.type.length) {
                    const parts = att[0].type.toLowerCase().split('/');
                    const type =  (parts[0] === 'application') ? parts[1] : parts[0];
                    fields.push(type[0].toUpperCase() + type.slice(1) + ' Attachment');
                }
                if (a.size) {
                    fields.push(F.tpl.help.humanbytes(a.size));
                }
                meta.push(fields.join(' | '));
            } else if (att.length > 1) {
                meta.push(`${att.length} Attachments`);
            }
            if (this.isIncoming() && this.hasErrors() && !meta.length) {
                meta.push('Error handling incoming message');
            }
            if (this.get('type') === 'clientOnly') {
                meta.push('Only visible to you');
            }
            return meta;
        },

        getNotificationText: function() {
            var meta = this.getMeta();
            if (meta.length) {
                return meta.join(', ');
            } else {
                return this.get('plain') || '';
            }
        },

        updateImageUrl: function() {
            this.revokeImageUrl();
            var attachment = this.get('attachments')[0];
            if (attachment) {
                var blob = new Blob([attachment.data], {
                    type: attachment.type
                });
                this.imageUrl = URL.createObjectURL(blob);
            } else {
                this.imageUrl = null;
            }
        },

        revokeImageUrl: function() {
            if (this.imageUrl) {
                URL.revokeObjectURL(this.imageUrl);
                this.imageUrl = null;
            }
        },

        getImageUrl: function() {
            if (this.imageUrl === undefined) {
                this.updateImageUrl();
            }
            return this.imageUrl;
        },

        getConversation: async function() {
            const id = this.get('conversationId');
            console.assert(id, 'No convo ID');
            let c = this.conversations.get(id);
            if (!c) {
                c = this.conversations.add({id}, {merge: true});
                await c.fetch();
            }
            return c;
        },

        getExpirationTimerUpdateSource: async function() {
            if (this.isExpirationTimerUpdate()) {
                const id = this.get('expirationTimerUpdate').source;
                console.assert(id, 'No convo ID');
                let c = this.conversations.get(id);
                if (!c) {
                    c = this.conversations.add({id, type: 'private'}, {merge: true});
                    await c.fetch();
                }
                return c;
            }
        },

        getSender: async function() {
            const addr = this.isIncoming() ? this.get('source') : await F.state.get('addr');
            return this.getUserByAddr(addr);
        },

        getUserByAddr: function(addr) {
            if (!this._users) {
                this._users = F.foundation.getUsers();
                this._usersAddrCache = {};
            }
            let user = this._usersAddrCache[addr];
            if (user) {
                return user;
            }
            user = this._users.findWhere({phone: addr}); // XXX lets get a signal addr field
            if (user) {
                this._usersAddrCache[addr] = user;
            }
            return user;
        },

        getModelForKeyChange: async function() {
            const id = this.get('key_changed');
            console.assert(id, 'No convo ID');
            let c = this.conversations.get(id);
            if (!c) {
                c = this.conversations.add({id, type: 'private'}, {merge: true});
                await c.fetch();
            }
            return c;
        },

        isOutgoing: function() {
            return this.get('type') === 'outgoing';
        },

        hasErrors: function() {
            return _.size(this.get('errors')) > 0;
        },

        hasKeyConflicts: function() {
            return _.any(this.get('errors'), function(e) {
                return (e.name === 'IncomingIdentityKeyError' ||
                        e.name === 'OutgoingIdentityKeyError');
            });
        },

        hasKeyConflict: function(addr) {
            return _.any(this.get('errors'), function(e) {
                return (e.name === 'IncomingIdentityKeyError' ||
                        e.name === 'OutgoingIdentityKeyError') &&
                        e.addr === addr;
            });
        },

        getKeyConflict: function(addr) {
            return _.find(this.get('errors'), function(e) {
                return (e.name === 'IncomingIdentityKeyError' ||
                        e.name === 'OutgoingIdentityKeyError') &&
                        e.addr === addr;
            });
        },

        send: async function(promise) {
            this.trigger('pending');
            let sent;
            let content;
            try {
                content = (await promise).content;
                sent = true;
            } catch(e) {
                if (e instanceof Error) {
                    await this.saveErrors(e);
                } else {
                    await this.saveErrors(e.errors);
                    sent = e.successfulAddrs.length > 0;
                    content = e.content;
                }
            } finally {
                if (content) {
                    this.set({content});
                }
                await this.save({sent, expirationStartTimestamp: Date.now()});
                this.trigger('done');
                this.queueSyncMessage();
            }
        },

        queueSyncMessage: function() {
            /* Append a sync message to the tail of any other pending sync messages. */
            const tail = this.syncPromise || Promise.resolve();
            const next = async function() {
                const content = this.get('content');
                if (this.get('synced') || !content) {
                    return;
                }
                await F.foundation.getMessageSender().sendSyncMessage(content,
                    this.get('sent_at'), this.get('destination'),
                    this.get('expirationStartTimestamp'));
                await this.save({synced: true, content: null});
            }.bind(this);
            this.syncPromise = tail.then(next, next);
        },

        saveErrors: async function(errors) {
            if (!(errors instanceof Array)) {
                errors = [errors];
            }
            errors = errors.map(e => {
                console.assert(e instanceof Error);
                /* Serialize the error for storage to the DB. */
                console.warn('Saving Message Error:', e);
                const obj = _.pick(e, 'name', 'message', 'code', 'addr',
                                   'reason', 'functionCode', 'args', 'stack');
                return obj;
            });
            errors = errors.concat(this.get('errors') || []);
            await this.save({errors});
        },

        removeConflictFor: function(addr) {
            var errors = _.reject(this.get('errors'), function(e) {
                return e.addr === addr &&
                    (e.name === 'IncomingIdentityKeyError' ||
                     e.name === 'OutgoingIdentityKeyError');
            });
            this.set({errors: errors});
        },

        hasNetworkError: function(addr) {
            var error = _.find(this.get('errors'), function(e) {
                return (e.name === 'MessageError' ||
                        e.name === 'OutgoingMessageError' ||
                        e.name === 'SendMessageNetworkError');
            });
            return !!error;
        },

        removeOutgoingErrors: function(addr) {
            var errors = _.partition(this.get('errors'), function(e) {
                return e.addr === addr &&
                    (e.name === 'MessageError' ||
                     e.name === 'OutgoingMessageError' ||
                     e.name === 'SendMessageNetworkError');
            });
            this.set({errors: errors[1]});
            return errors[0][0];
        },

        resend: function(addr) {
            var error = this.removeOutgoingErrors(addr);
            if (error) {
                var promise = new textsecure.ReplayableError(error).replay();
                this.send(promise);
            }
        },

        resolveConflict: function(addr) {
            var error = this.getKeyConflict(addr);
            if (error) {
                this.removeConflictFor(addr);
                var promise = new textsecure.ReplayableError(error).replay();
                if (this.isIncoming()) {
                    promise = promise.then(function(content) {
                        this.removeConflictFor(addr);
                        return this.handleDataMessage(content.dataMessage);
                    }.bind(this));
                } else {
                    promise = this.send(promise).then(function() {
                        this.removeConflictFor(addr);
                        return this.save();
                    }.bind(this));
                }
                promise.catch(function(e) {
                    this.removeConflictFor(addr);
                    this.saveErrors(e);
                }.bind(this));

                return promise;
            }
        },

        parseBody(raw) {
            let contents;
            try {
                contents = JSON.parse(raw);
            } catch(e) {
                /* Don't blindly accept data that passes JSON.parse in case the peer
                 * unwittingly sent us something JSON parsable. */
            }
            if (!contents || !contents.length) {
                console.warn("Legacy unstructured message content received!");
                contents = [{
                    version: 1,
                    data: {
                        body: [{
                            type: 'text/plain',
                            value: raw
                        }]
                    }
                }];
            }
            let bestVersion;
            for (const x of contents) {
                if (x.version === 1) {
                    bestVersion = x;
                }
            }
            if (!bestVersion) {
                throw new Error(`Unexpected message schema: ${raw}`);
            }
            return bestVersion;
        },

        parseAttachments(body, protoAttachments) {
            /* Combine meta data from our body into the protocol level
             * attachment data. */
            const metaAttachments = body.data && body.data.attachments;
            return protoAttachments.map((attx, i) => {
                const meta = metaAttachments ? metaAttachments[i] : {};
                return {
                    data: attx.data,
                    type: attx.contentType,
                    name: meta.name,
                    size: meta.size,
                    mtime: meta.mtime,
                };
            });
        },

        handleDataMessage: async function(dataMessage) {
            const message = this;
            const source = message.get('source');
            const type = message.get('type');
            const peer = type === 'incoming' ? source : message.get('destination');
            const body = dataMessage.body ? this.parseBody(dataMessage.body) : {};
            const attachments = this.parseAttachments(body, dataMessage.attachments);
            const group = dataMessage.group;
            let conversation;
            const cid = (group && group.id) || body.threadId;
            if (cid) {
                conversation = this.conversations.get(cid);
            } else {
                console.warn("Message did not provide group.id or threadId to locate a conversation");
            }
            if (!conversation) {
                if (group) {
                    console.warn("Creating group convo from incomplete data:", group.members);
                    conversation = await this.conversations.make({
                        id: group.id,
                        name: body.threadName || group.name || group.members.join(', '),
                        recipients: group.members
                    });
                } else {
                    const matches = this.conversations.filter(x => {
                        const r = x.get('recipients');
                        return r.length === 1 && r[0] === peer;
                    });
                    if (matches.length) {
                        conversation = matches[0];
                    } else {
                        const user = F.foundation.getUsers().findWhere({phone: peer});
                        console.info("Creating new private convo with:", user.getName());
                        conversation = await this.conversations.make({
                            name: user.getName(),
                            recipients: [peer],
                            users: [user.id]
                        });
                    }
                }
            }
            conversation.queueJob(async function() {
                const now = Date.now();
                const convo_updates = {
                    active_at: now,
                    timestamp: now
                };
                if (dataMessage.group) {
                    let group_update;
                    if (dataMessage.group.type === textsecure.protobuf.GroupContext.Type.UPDATE) {
                        if (!dataMessage.group.members || !dataMessage.group.members.length) {
                            throw new Error("invalid assertion about group updates having membership"); // XXX
                        }
                        const members = new F.util.ESet(dataMessage.group.members);
                        members.delete(await F.state.get('addr'));
                        Object.assign(convo_updates, {
                            name: dataMessage.group.name,
                            avatar: dataMessage.group.avatar,
                            recipients: Array.from(members)
                        });
                        const oldMembers = new F.util.ESet(conversation.get('recipients'));
                        const joined = members.difference(oldMembers);
                        const left = oldMembers.difference(members);
                        group_update = conversation.changedAttributes(_.pick(dataMessage.group,
                            'name', 'avatar')) || {};
                        if (joined.size) {
                            group_update.joined = Array.from(joined);
                        }
                        if (left.size) {
                            group_update.left = Array.from(left);
                        }
                    } else if (dataMessage.group.type === textsecure.protobuf.GroupContext.Type.QUIT) {
                        group_update = {left: [source]};
                        convo_updates.recipients = _.without(conversation.get('recipients'), source);
                    }
                    if (group_update) {
                        message.set({group_update});
                    }
                }
                const getText = type => {
                    if (!body.data) {
                        return null;
                    }
                    for (const x of body.data.body)
                        if (x.type === `text/${type}`)
                            return x.value;
                };
                message.set({
                    plain: getText('plain'),
                    html: getText('html'),
                    conversationId: conversation.id,
                    attachments,
                    decrypted_at: now,
                    flags: dataMessage.flags,
                    errors: []
                });
                convo_updates.lastMessage = message.getNotificationText();
                if (type === 'outgoing') {
                    var receipts = F.DeliveryReceipts.forMessage(conversation, message);
                    receipts.forEach(function(receipt) {
                        message.set({
                            delivered: (message.get('delivered') || 0) + 1
                        });
                    });
                } else if (type === 'incoming') {
                    if (F.ReadReceipts.forMessage(message) || message.isExpirationTimerUpdate()) {
                        message.unset('unread');
                    } else {
                        convo_updates.unreadCount = conversation.get('unreadCount') + 1;
                    }
                }
                if (message.isExpirationTimerUpdate()) {
                    message.set('expirationTimerUpdate', {
                        source,
                        expireTimer: dataMessage.expireTimer
                    });
                    conversation.set('expireTimer', dataMessage.expireTimer);
                } else if (dataMessage.expireTimer) {
                    message.set('expireTimer', dataMessage.expireTimer);
                }
                if (!message.isEndSession()) {
                    if (dataMessage.expireTimer) {
                        if (dataMessage.expireTimer !== conversation.get('expireTimer')) {
                          conversation.addExpirationTimerUpdate(
                              dataMessage.expireTimer, source,
                              message.get('received_at'));
                        }
                    } else if (conversation.get('expireTimer')) {
                        conversation.addExpirationTimerUpdate(0, source,
                            message.get('received_at'));
                    }
                }
                var conversation_timestamp = conversation.get('timestamp');
                if (!conversation_timestamp || message.get('sent_at') > conversation_timestamp) {
                    conversation.set({
                        timestamp: message.get('sent_at')
                    });
                }
                await Promise.all([message.save(), conversation.save(convo_updates)]);
                conversation.trigger('newmessage', message);
                if (message.get('unread')) {
                    conversation.notify(message);
                }
            });
        },

        markRead: async function(read_at) {
            this.unset('unread');
            if (this.get('expireTimer') && !this.get('expirationStartTimestamp')) {
                this.set('expirationStartTimestamp', read_at || Date.now());
            }
            F.Notifications.remove(F.Notifications.where({
                messageId: this.id
            }));
            await this.save();
        },

        markExpired: async function() {
            this.trigger('expired', this);
            (await this.getConversation()).trigger('expired', this);
            this.destroy();
        },

        isExpiring: function() {
            return this.get('expireTimer') && this.get('expirationStartTimestamp');
        },

        msTilExpire: function() {
              if (!this.isExpiring()) {
                return Infinity;
              }
              var now = Date.now();
              var start = this.get('expirationStartTimestamp');
              var delta = this.get('expireTimer') * 1000;
              var ms_from_now = start + delta - now;
              if (ms_from_now < 0) {
                  ms_from_now = 0;
              }
              return ms_from_now;
        },

        setToExpire: function() {
            if (this.isExpiring() && !this.expireTimer) {
                var ms_from_now = this.msTilExpire();
                setTimeout(this.markExpired.bind(this), ms_from_now);
            }
        }
    });

    F.MessageCollection = Backbone.Collection.extend({
        model: F.Message,
        database: F.Database,
        storeName: 'messages',
        comparator: 'received_at',

        initialize: function(models, options) {
            if (options) {
                this.conversation = options.conversation;
            }
        },

        destroyAll: async function () {
            await Promise.all(this.models.map(m => m.destroy()));
        },

        fetchSentAt: async function(timestamp) {
            await this.fetch({
                index: {
                    // 'receipt' index on sent_at
                    name: 'receipt',
                    only: timestamp
                }
            }); // XXX used to never fail!
        },

        fetchConversation: async function(conversationId, limit) {
            if (typeof limit !== 'number') {
                limit = 20;
            }
            let upper;
            if (this.length === 0) {
                // fetch the most recent messages first
                upper = Number.MAX_VALUE;
            } else {
                // not our first rodeo, fetch older messages.
                upper = this.at(0).get('received_at');
            }
            await this.fetch({
                remove: false,
                limit,
                index: {
                    // 'conversation' index on [conversationId, received_at]
                    name  : 'conversation',
                    lower : [conversationId],
                    upper : [conversationId, upper],
                    order : 'desc'
                    // SELECT messages WHERE conversationId = this.id ORDER
                    // received_at DESC
                }
            });
        },

        fetchExpiring: async function() {
            await this.fetch({conditions: {expireTimer: {$gte: 0}}});
        },

        hasKeyConflicts: function() {
            return this.any(m => m.hasKeyConflicts());
        }
    });
})();
