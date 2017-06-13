/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';
    window.Whisper = window.Whisper || {};

    Whisper.Message = Backbone.Model.extend({
        database: Whisper.Database,
        storeName: 'messages',

        initialize: function() {
            this.conversations = Whisper.getConversations();
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
            var flag = textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE;
            return !!(this.get('flags') & flag);
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

        getDescription: function() {
            if (this.isGroupUpdate()) {
                var group_update = this.get('group_update');
                if (group_update.left) {
                    return group_update.left + ' left the group.';
                }

                var messages = ['Updated the group.'];
                if (group_update.name) {
                    messages.push("Title is now '" + group_update.name + "'.");
                }
                if (group_update.joined) {
                    messages.push(group_update.joined.join(', ') + ' joined the group.');
                }

                return messages.join(' ');
            }
            if (this.isEndSession()) {
                return i18n('sessionEnded');
            }
            if (this.isIncoming() && this.hasKeyConflicts()) {
                return i18n('incomingKeyConflict');
            }
            if (this.isIncoming() && this.hasErrors()) {
                return i18n('incomingError');
            }
            return this.get('plain');
        },

        getNotificationText: function() {
            var description = this.getDescription();
            if (description) {
                return description;
            }
            if (this.get('attachments').length > 0) {
                return i18n('mediaMessage');
            }
            if (this.isExpirationTimerUpdate()) {
                return i18n('timerSetTo',
                    Whisper.ExpirationTimerOptions.getAbbreviated(
                      this.get('expirationTimerUpdate').expireTimer
                    )
                );
            }
            return '';
        },

        updateImageUrl: function() {
            this.revokeImageUrl();
            var attachment = this.get('attachments')[0];
            if (attachment) {
                var blob = new Blob([attachment.data], {
                    type: attachment.contentType
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

        getConversation: function() {
            const id = this.get('conversationId');
            console.assert(id, 'No convo ID');
            let c = this.conversations.get(id);
            if (!c) {
                console.warn("XXX: Lazy load of conversation!");
                c = this.conversations.add({id}, {merge: true});
                console.warn("XXX: Doing async fetch from sync func");
                c.fetch();
            }
            return c;
        },

        getExpirationTimerUpdateSource: function() {
            if (this.isExpirationTimerUpdate()) {
                const id = this.get('expirationTimerUpdate').source;
                console.assert(id, 'No convo ID');
                let c = this.conversations.get(id);
                if (!c) {
                    console.warn("XXX: Lazy inplace-create of conversation!");
                    c = this.conversations.add({id, type: 'private'}, {merge: true});
                    console.warn("XXX: Doing async fetch from sync func");
                    c.fetch();
                }
                return c;
            }
        },

        getContact: function(refresh) {
            const id = this.isIncoming() ? this.get('source') :
                       textsecure.storage.user.getNumber();
            console.assert(id, 'No convo ID');
            let c = this.conversations.get(id);
            if (!c) {
                console.warn("XXX: Lazy inplace-create of conversation!");
                c = this.conversations.add({id, type: 'private'}, {merge: true});
                console.warn("XXX: Doing async fetch from sync func");
                c.fetch();
            }
            return c;
        },

        getModelForKeyChange: function() {
            const id = this.get('key_changed');
            console.assert(id, 'No convo ID');
            let c = this.conversations.get(id);
            if (!c) {
                console.warn("XXX: Lazy inplace-create of conversation!");
                c = this.conversations.add({id, type: 'private'}, {merge: true});
                console.warn("XXX: Doing async fetch from sync func");
                c.fetch();
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

        send: function(promise) {
            this.trigger('pending');
            return promise.then(function(result) {
                var now = Date.now();
                this.trigger('done');
                if (result.dataMessage) {
                    this.set({dataMessage: result.dataMessage});
                }
                this.save({sent: true, expirationStartTimestamp: now});
                this.sendSyncMessage();
            }.bind(this)).catch(function(result) {
                var now = Date.now();
                this.trigger('done');
                if (result.dataMessage) {
                    this.set({dataMessage: result.dataMessage});
                }
                if (result instanceof Error) {
                    this.saveErrors(result);
                } else {
                    this.saveErrors(result.errors);
                    if (result.successfulNumbers.length > 0) {
                        this.set({sent: true, expirationStartTimestamp: now});
                        this.sendSyncMessage();
                    }
                }
            }.bind(this));
        },

        sendSyncMessage: function() {
            this.syncPromise = this.syncPromise || Promise.resolve();
            this.syncPromise = this.syncPromise.then(function() {
                var dataMessage = this.get('dataMessage');
                if (this.get('synced') || !dataMessage) {
                    return;
                }
                return textsecure.messaging.sendSyncMessage(
                    dataMessage, this.get('sent_at'), this.get('destination'), this.get('expirationStartTimestamp')
                ).then(function() {
                    this.save({synced: true, dataMessage: null});
                }.bind(this));
            }.bind(this));
        },

        saveErrors: function(errors) {
            if (!(errors instanceof Array)) {
                errors = [errors];
            }
            errors.forEach(function(e) {
                console.log(e);
                console.log(e.reason, e.stack);
            });
            errors = errors.map(function(e) {
                if (e.constructor === Error ||
                    e.constructor === TypeError ||
                    e.constructor === ReferenceError) {
                    return _.pick(e, 'name', 'message', 'code', 'number', 'reason');
                }
                return e;
            });
            errors = errors.concat(this.get('errors') || []);

            return this.save({errors : errors});
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
                        this.handleDataMessage(dataMessage);
                    }.bind(this));
                } else {
                    promise = this.send(promise).then(function() {
                        this.removeConflictFor(number);
                        this.save();
                    }.bind(this));
                }
                promise.catch(function(e) {
                    this.removeConflictFor(number);
                    this.saveErrors(e);
                }.bind(this));

                return promise;
            }
        },

        handleDataMessage: function(dataMessage) {
            // This function can be called from the background script on an
            // incoming message or from the frontend after the user accepts an
            // identity key change.
            var message = this;
            var source = message.get('source');
            var type = message.get('type');
            var timestamp = message.get('sent_at');
            var conversationId = message.get('conversationId');
            if (dataMessage.group) {
                conversationId = dataMessage.group.id;
            }
            var conversation = this.conversations.get(conversationId);
            if (!conversation) {
                console.warn("Creating new convo for:", conversationId);
                conversation = this.conversations.add({id: conversationId}, {merge: true});
            }
            conversation.queueJob(function() {
                return new Promise(function(resolve) {
                    conversation.fetch().always(function() {
                        var now = new Date().getTime();
                        var attributes = { type: 'private' };
                        let contents;
                        try {
                            contents = JSON.parse(dataMessage.body);
                        } catch(e) {
                            /* Don't blindly accept data that passes JSON.parse in case the user
                             * accidentally entered something resembling JSON. */ 
                        }
                        if (!contents || !contents.length) {
                            console.warn("Legacy unstructured message content received!");
                            contents = [{
                                version: 1,
                                data: {
                                    body: [{
                                        type: 'text/plain',
                                        value: dataMessage.body
                                    }, {
                                        type: 'text/html',
                                        value: dataMessage.body
                                    }]
                                }
                            }];
                        }
                        let bestContent;
                        for (const x of contents) {
                            if (x.version === 1) {
                                bestContent = x;
                            }
                        }
                        if (!bestContent) {
                            throw new Error("Unhandled Message Version!");
                        }
                        if (dataMessage.group) {
                            var group_update = null;
                            attributes = {
                                type: 'group',
                                groupId: dataMessage.group.id,
                            };
                            if (dataMessage.group.type === textsecure.protobuf.GroupContext.Type.UPDATE) {
                                attributes = {
                                    type: 'group',
                                    groupId: dataMessage.group.id,
                                    name: dataMessage.group.name,
                                    avatar: dataMessage.group.avatar,
                                    members: dataMessage.group.members,
                                };
                                group_update = conversation.changedAttributes(_.pick(dataMessage.group, 'name', 'avatar')) || {};
                                var difference = _.difference(dataMessage.group.members, conversation.get('members'));
                                if (difference.length > 0) {
                                    group_update.joined = difference;
                                }
                            }
                            else if (dataMessage.group.type === textsecure.protobuf.GroupContext.Type.QUIT) {
                                if (source == textsecure.storage.user.getNumber()) {
                                    group_update = { left: "You" };
                                } else {
                                    group_update = { left: source };
                                }
                                attributes.members = _.without(conversation.get('members'), source);
                            }

                            if (group_update !== null) {
                                message.set({group_update: group_update});
                            }
                        }
                        const getBody = type => {
                            for (const x of bestContent.data.body)
                                if (x.type === type)
                                    return x.value;
                        };
                        message.set({
                            plain: getBody('text/plain'),
                            html: getBody('text/html'),
                            conversationId: conversation.id,
                            attachments: dataMessage.attachments,
                            decrypted_at: now,
                            flags: dataMessage.flags,
                            errors: []
                        });
                        if (type === 'outgoing') {
                            var receipts = Whisper.DeliveryReceipts.forMessage(conversation, message);
                            receipts.forEach(function(receipt) {
                                message.set({
                                    delivered: (message.get('delivered') || 0) + 1
                                });
                            });
                        }
                        attributes.active_at = now;
                        if (type === 'incoming') {
                            // experimental
                            if (Whisper.ReadReceipts.forMessage(message) || message.isExpirationTimerUpdate()) {
                                message.unset('unread');
                            } else {
                                attributes.unreadCount = conversation.get('unreadCount') + 1;
                            }
                        }
                        conversation.set(attributes);

                        if (message.isExpirationTimerUpdate()) {
                            message.set({
                                expirationTimerUpdate: {
                                    source      : source,
                                    expireTimer : dataMessage.expireTimer
                                }
                            });
                            conversation.set({expireTimer: dataMessage.expireTimer});
                        } else if (dataMessage.expireTimer) {
                            message.set({expireTimer: dataMessage.expireTimer});
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
                        conversation.set({
                            lastMessage: message.getNotificationText()
                        });

                        message.save().then(function() {
                            conversation.save().then(function() {
                                conversation.trigger('newmessage', message);
                                if (message.get('unread')) {
                                    conversation.notify(message);
                                }
                                resolve();
                            });
                        });
                    });
                });
            });
        },

        markRead: function(read_at) {
            this.unset('unread');
            if (this.get('expireTimer') && !this.get('expirationStartTimestamp')) {
                this.set('expirationStartTimestamp', read_at || Date.now());
            }
            Whisper.Notifications.remove(Whisper.Notifications.where({
                messageId: this.id
            }));
            return this.save();
        },

        markExpired: function() {
            this.trigger('expired', this);
            this.getConversation().trigger('expired', this);
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
                console.log('message', this.id, 'expires in', ms_from_now, 'ms');
                setTimeout(this.markExpired.bind(this), ms_from_now);
            }
        }
    });

    Whisper.MessageCollection = Backbone.Collection.extend({
        model: Whisper.Message,
        database: Whisper.Database,
        storeName: 'messages',
        comparator: 'received_at',

        initialize : function(models, options) {
            if (options) {
                this.conversation = options.conversation;
            }
        },

        destroyAll : function () {
            return Promise.all(this.models.map(function(m) {
                return new Promise(function(resolve, reject) {
                    m.destroy().then(resolve).fail(reject);
                });
            }));
        },

        fetchSentAt: function(timestamp) {
            return new Promise(function(resolve) {
                return this.fetch({
                    index: {
                        // 'receipt' index on sent_at
                        name: 'receipt',
                        only: timestamp
                    }
                }).always(resolve);
            }.bind(this));
        },

        fetchConversation: function(conversationId, limit) {
            if (typeof limit !== 'number') {
                limit = 100;
            }
            return new Promise(function(resolve) {
                var upper;
                if (this.length === 0) {
                    // fetch the most recent messages first
                    upper = Number.MAX_VALUE;
                } else {
                    // not our first rodeo, fetch older messages.
                    upper = this.at(0).get('received_at');
                }
                var options = {remove: false, limit: limit};
                options.index = {
                    // 'conversation' index on [conversationId, received_at]
                    name  : 'conversation',
                    lower : [conversationId],
                    upper : [conversationId, upper],
                    order : 'desc'
                    // SELECT messages WHERE conversationId = this.id ORDER
                    // received_at DESC
                };
                this.fetch(options).then(resolve);
            }.bind(this));
        },

        fetchExpiring: function() {
            this.fetch({conditions: {expireTimer: {$gte: 0}}});
        },

        hasKeyConflicts: function() {
            return this.any(function(m) { return m.hasKeyConflicts(); });
        }
    });
})();