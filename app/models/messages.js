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

        isUnread: function() {
            return !!this.get('unread');
        },

        getMeta: function() {
            const meta = [];
            if (this.isGroupUpdate()) {
                const group_update = this.get('group_update');
                if (group_update.left) {
                    console.log('XXX lookup users');
                    meta.push(group_update.left + ' left the conversation');
                }
                if (group_update.name) {
                    meta.push(`Conversation title changed to "${group_update.name}"`);
                }
                if (group_update.joined) {
                    console.log('XXX lookup users');
                    meta.push(group_update.joined.join(', ') + ' joined the conversation');
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
                let prefix = '';
                if (att[0].type.length) {
                    const parts = att[0].type.toLowerCase().split('/');
                    const type =  (parts[0] === 'application') ? parts[1] : parts[0];
                    prefix = type[0].toUpperCase() + type.slice(1) + ' ';
                }
                let att_size = att[0].size / 1024;
                let size_unit = ' KB';
                if(att_size > 1000) {
                    att_size = (att_size / 1024).toFixed(2);
                    size_unit = ' MB';
                }
                else {
                    att_size = (att_size).toFixed(0);
                }
                meta.push(`${prefix}Attachment | ${att_size}${size_unit} | ${att[0].name}`);
            } else if (att.length > 1) {
                meta.push(`${att.length} Attachments`);
            }
            if (this.isIncoming() && this.hasErrors() && !meta.length) {
                meta.push('Error handling incoming message');
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
            const source = this.isIncoming() ? this.get('source') : await F.state.get('number');
            return  F.foundation.getUsers().findWhere({phone: source});
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

        hasKeyConflict: function(number) {
            return _.any(this.get('errors'), function(e) {
                return (e.name === 'IncomingIdentityKeyError' ||
                        e.name === 'OutgoingIdentityKeyError') &&
                        e.number === number;
            });
        },

        getKeyConflict: function(number) {
            return _.find(this.get('errors'), function(e) {
                return (e.name === 'IncomingIdentityKeyError' ||
                        e.name === 'OutgoingIdentityKeyError') &&
                        e.number === number;
            });
        },

        send: async function(promise) {
            this.trigger('pending');
            let sent;
            let dataMessage;
            try {
                dataMessage = (await promise).dataMessage;
                sent = true;
            } catch(e) {
                if (e instanceof Error) {
                    await this.saveErrors(e);
                } else {
                    await this.saveErrors(e.errors);
                    sent = e.successfulNumbers.length > 0;
                    dataMessage = e.dataMessage;
                }
            } finally {
                if (dataMessage) {
                    this.set({dataMessage});
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
                const dataMessage = this.get('dataMessage');
                if (this.get('synced') || !dataMessage) {
                    return;
                }
                await F.foundation.getMessageSender().sendSyncMessage(dataMessage,
                    this.get('sent_at'), this.get('destination'),
                    this.get('expirationStartTimestamp'));
                await this.save({synced: true, dataMessage: null});
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
                const obj = _.pick(e, 'name', 'message', 'code', 'number',
                                   'reason', 'functionCode', 'args', 'stack');
                return obj;
            });
            errors = errors.concat(this.get('errors') || []);
            await this.save({errors});
        },

        removeConflictFor: function(number) {
            var errors = _.reject(this.get('errors'), function(e) {
                return e.number === number &&
                    (e.name === 'IncomingIdentityKeyError' ||
                     e.name === 'OutgoingIdentityKeyError');
            });
            this.set({errors: errors});
        },

        hasNetworkError: function(number) {
            var error = _.find(this.get('errors'), function(e) {
                return (e.name === 'MessageError' ||
                        e.name === 'OutgoingMessageError' ||
                        e.name === 'SendMessageNetworkError');
            });
            return !!error;
        },

        removeOutgoingErrors: function(number) {
            var errors = _.partition(this.get('errors'), function(e) {
                return e.number === number &&
                    (e.name === 'MessageError' ||
                     e.name === 'OutgoingMessageError' ||
                     e.name === 'SendMessageNetworkError');
            });
            this.set({errors: errors[1]});
            return errors[0][0];
        },

        resend: function(number) {
            var error = this.removeOutgoingErrors(number);
            if (error) {
                var promise = new textsecure.ReplayableError(error).replay();
                this.send(promise);
            }
        },

        resolveConflict: function(number) {
            var error = this.getKeyConflict(number);
            if (error) {
                this.removeConflictFor(number);
                var promise = new textsecure.ReplayableError(error).replay();
                if (this.isIncoming()) {
                    promise = promise.then(function(dataMessage) {
                        this.removeConflictFor(number);
                        return this.handleDataMessage(dataMessage);
                    }.bind(this));
                } else {
                    promise = this.send(promise).then(function() {
                        this.removeConflictFor(number);
                        return this.save();
                    }.bind(this));
                }
                promise.catch(function(e) {
                    this.removeConflictFor(number);
                    this.saveErrors(e);
                }.bind(this));

                return promise;
            }
        },

        parseBody(dataMessage) {
            let contents;
            try {
                contents = JSON.parse(dataMessage.body);
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
                            value: dataMessage.body
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
                throw new Error(`Unexpected message schema: ${dataMessage.body}`);
            }
            return bestVersion;
        },
        parseAttachments(body, att) {
          let attx = [];
          if (body.data.attachments) {
              for (let i = 0; i < body.data.attachments.length; i++) {
                  const meta = body.data.attachments[i];
                  attx.push({
                      name: meta.name,
                      size: meta.size,
                      type: meta.type,
                      mtime: meta.mtime,
                      data: att[0].data
                  });
              }
          }
          return attx;
        },

        handleDataMessage: async function(dataMessage) {
            // This function can be called from the background script on an
            // incoming message or from the frontend after the user accepts an
            // identity key change.
            const message = this;
            const source = message.get('source');
            const type = message.get('type');
            const body = this.parseBody(dataMessage);
            const attx = this.parseAttachments(body, dataMessage.attachments);
            const group = dataMessage.group;
            let conversation;
            if (body.threadId) {
                conversation = this.conversations.get(body.threadId);
            } else {
                console.warn("Message body did not provide threadId (conversation ID)");
            }
            if (!conversation) {
                if (group) {
                    conversation = this.conversations.findWhere({groupId: group.id});
                    if (!conversation) {
                        console.warn("Creating group convo with incomplete data:");
                        conversation = await this.conversations.makeNew({
                            groupId: group.id,
                            name: body.threadName || group.name || 'Unnamed Group',
                            recipients: group.members
                        });
                    }
                } else {
                    const matches = this.conversations.filter(x => {
                        const r = x.get('recipients');
                        return r.length === 1 && r[0] === source;
                    });
                    if (matches.length) {
                        conversation = matches[0];
                    } else {
                        console.warn("Creating private convo with incomplete data:");
                        const user = F.foundation.getUsers().findWhere({phone: source});
                        conversation = await this.conversations.makeNew({
                            name: user.get('first_name') + ' ' + user.get('last_name'),
                            recipients: [source],
                            users: [user.id]
                        });
                    }
                }
            }
            conversation.queueJob(async function() {
                /* Get latest conversation data before altering state. */
                await conversation.fetch({not_found_error: false});
                const now = new Date().getTime();
                const convo_updates = {
                    active_at: now
                };
                if (dataMessage.group) {
                    var group_update = null;
                    if (dataMessage.group.type === textsecure.protobuf.GroupContext.Type.UPDATE) {
                        Object.assign(convo_updates, {
                            name: dataMessage.group.name,
                            avatar: dataMessage.group.avatar,
                            recipients: dataMessage.group.members,
                        });
                        group_update = conversation.changedAttributes(_.pick(dataMessage.group,
                            'name', 'avatar')) || {};
                        var difference = _.difference(dataMessage.group.members,
                            conversation.get('recipients'));
                        if (difference.length > 0) {
                            group_update.joined = difference;
                        }
                    } else if (dataMessage.group.type === textsecure.protobuf.GroupContext.Type.QUIT) {
                        if (source === await F.state.get('number')) {
                            group_update = {left: "You"};
                        } else {
                            group_update = {left: source};
                        }
                        convo_updates.recipients = _.without(conversation.get('recipients'), source);
                    }
                    if (group_update !== null) {
                        message.set({group_update: group_update});
                    }
                }
                const getText = type => {
                    for (const x of body.data.body)
                        if (x.type === `text/${type}`)
                            return x.value;
                };
                message.set({
                    plain: getText('plain'),
                    html: getText('html'),
                    conversationId: conversation.id,
                    attachments: attx,
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
                }
                if (type === 'incoming') {
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
