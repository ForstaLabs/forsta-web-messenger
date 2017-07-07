/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
  'use strict';

   self.F = self.F || {};

   const COLORS = [
        'red',
        'orange',
        'yellow',
        'olive',
        'green',
        'teal',
        'blue',
        'violet',
        'pink',
        'brown',
        'grey',
        'black'
    ];

    const userAgent = [
        `ForstaWeb/${F.version}`,
        `(${forsta_env.GIT_BRANCH}, ${forsta_env.GIT_COMMIT.substring(0, 10)})`,
        navigator.userAgent
    ].join(' ');

    /* NOTE: Stuff is going to get weird here.  A contact is not a real thing, it's
     * actually just a conversation entry of type: private.  So any contact refs
     * are actually private conversations.  You've been warned! */
    F.Conversation = Backbone.Model.extend({
        database: F.Database,
        storeName: 'conversations',

        defaults: function() {
            return { unreadCount : 0 };
        },

        initialize: function() {
            this.contactCollection = new Backbone.Collection();
            this.messageCollection = new F.MessageCollection([], {
                conversation: this
            });
            this.on('change:avatar', this.updateAvatarUrl);
            this.on('destroy', this.revokeAvatarUrl);
            this.on('read', this.onReadMessage);
            this.fetchContacts().then(function() {
                this.contactCollection.each(function(contact) {
                    textsecure.store.on('keychange:' + contact.id, function() {
                        this.addKeyChange(contact.id);
                    }.bind(this));
                }.bind(this));
            }.bind(this));
        },

        addKeyChange: function(id) {
            var message = this.messageCollection.add({
                conversationId : this.id,
                type           : 'keychange',
                sent_at        : this.get('timestamp'),
                received_at    : this.get('timestamp'),
                key_changed    : id
            });
            message.save();
        },

        onReadMessage: function(message) {
            if (this.messageCollection.get(message.id)) {
                this.messageCollection.get(message.id).fetch();
            }

            return this.getUnread().then(function(unreadMessages) {
                this.save({unreadCount: unreadMessages.length});
            }.bind(this));
        },

        getUnread: async function() {
            const unread = new F.MessageCollection();
            await unread.fetch({
                index: {
                    // 'unread' index
                    name  : 'unread',
                    lower : [this.id],
                    upper : [this.id, Number.MAX_VALUE],
                }
            }); // XXX this used to never fail!
            return unread;
        },

        validate: function(attributes, options) {
            var required = ['id', 'type'];
            var missing = _.filter(required, function(attr) { return !attributes[attr]; });
            if (missing.length) { return "Conversation must have " + missing; }

            if (attributes.type !== 'private' && attributes.type !== 'group') {
                return "Invalid conversation type: " + attributes.type;
            }
            this.updateTokens();
        },

        updateTokens: function() {
            var tokens = [];
            var name = this.get('name');
            if (typeof name === 'string') {
                tokens.push(name.toLowerCase());
                tokens = tokens.concat(name.trim().toLowerCase().split(/[\s\-_\(\)\+]+/));
            }
            this.set({tokens: tokens});
        },

        queueJob: function(callback) {
            var previous = this.pending || Promise.resolve();
            var current = this.pending = previous.then(callback, callback);
            const cleanup = _ => {
                if (this.pending === current) {
                    delete this.pending;
                }
            };
            current.then(cleanup, cleanup);
            return current;
        },

        sendMessage: function(plain, html, attachments) {
            return this.queueJob(async function() {
                var now = Date.now();
                var message = this.messageCollection.add({
                    plain: plain,
                    html: html,
                    conversationId: this.id,
                    type: 'outgoing',
                    attachments: attachments,
                    sent_at: now,
                    received_at: now,
                    expireTimer: this.get('expireTimer')
                });
                if (this.isPrivate()) {
                    message.set({destination: this.id});
                }
                const bg = [];
                bg.push(message.save());
                bg.push(this.save({
                    unreadCount : 0,
                    active_at   : now,
                    timestamp   : now,
                    lastMessage : message.getNotificationText()
                }));
                let sendFunc;
                if (this.get('type') == 'private') {
                    sendFunc = textsecure.messaging.sendMessageToNumber;
                } else {
                    sendFunc = textsecure.messaging.sendMessageToGroup;
                }
                // XXX Obviously move this to a much smarter serializer
                const msg = JSON.stringify([{
                    version: 1,
                    type: 'ordinary',
                    userAgent,
                    data: {
                        body: [{
                            type: 'text/html',
                            value: html
                        }, {
                            type: 'text/plain',
                            value: plain
                        }],
                        files: attachments.map(function(item) {
                          return {
                            fileName: item.fileName,
                            fileSize: item.fileSize,
                            fileType: item.fileType,
                            fileLastModified: item.fileLastModified
                          }
                        })
                    },
                    sendTime: (new Date(now)).toISOString(),
                }]);
                bg.push(message.send(sendFunc(this.get('id'), msg, attachments,
                                     now, this.get('expireTimer'))));
                await Promise.all(bg);
            }.bind(this));
        },

        updateLastMessage: function() {
            var lastMessage = this.messageCollection.at(this.messageCollection.length - 1);
            if (lastMessage) {
              this.save({
                lastMessage : lastMessage.getNotificationText(),
                timestamp   : lastMessage.get('sent_at')
              });
            } else {
              this.save({
                lastMessage: '',
                timestamp: null
              });
            }
        },

        addExpirationTimerUpdate: function(expireTimer, source, received_at) {
            received_at = received_at || Date.now();
            this.save({ expireTimer: expireTimer });
            var message = this.messageCollection.add({
                conversationId: this.id,
                type: 'outgoing',
                sent_at: received_at,
                received_at: received_at,
                flags: textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE,
                expirationTimerUpdate: {
                    expireTimer: expireTimer,
                    source: source
                }
            });
            if (this.isPrivate()) {
                message.set({destination: this.id});
            }
            message.save();
            return message;
        },

        sendExpirationTimerUpdate: async function(time) {
            const number = await F.state.get('number');
            var message = this.addExpirationTimerUpdate(time, number);
            var sendFunc;
            if (this.get('type') == 'private') {
                sendFunc = textsecure.messaging.sendExpirationTimerUpdateToNumber;
            } else {
                sendFunc = textsecure.messaging.sendExpirationTimerUpdateToGroup;
            }
            message.send(sendFunc(this.get('id'), this.get('expireTimer'), message.get('sent_at')));
        },

        isSearchable: function() {
            return !this.get('left') || !!this.get('lastMessage');
        },

        endSession: function() {
            if (this.isPrivate()) {
                var now = Date.now();
                var message = this.messageCollection.create({
                    conversationId : this.id,
                    type           : 'outgoing',
                    sent_at        : now,
                    received_at    : now,
                    destination    : this.id,
                    flags          : textsecure.protobuf.DataMessage.Flags.END_SESSION
                });
                message.send(textsecure.messaging.closeSession(this.id, now));
            }
        },

        updateGroup: function(group_update) {
            if (this.isPrivate()) {
                throw new Error("Called update group on private conversation");
            }
            if (group_update === undefined) {
                group_update = this.pick(['name', 'avatar', 'members']);
            }
            var now = Date.now();
            var message = this.messageCollection.create({
                conversationId : this.id,
                type           : 'outgoing',
                sent_at        : now,
                received_at    : now,
                group_update   : group_update
            });
            message.send(textsecure.messaging.updateGroup(
                this.id,
                this.get('name'),
                this.get('avatar'),
                this.get('members')
            ));
        },

        leaveGroup: function() {
            var now = Date.now();
            if (this.get('type') === 'group') {
                this.save({left: true});
                var message = this.messageCollection.create({
                    group_update: { left: 'You' },
                    conversationId : this.id,
                    type           : 'outgoing',
                    sent_at        : now,
                    received_at    : now
                });
                message.send(textsecure.messaging.leaveGroup(this.id));
            }
        },

        markRead: function() {
            if (this.get('unreadCount') > 0) {
                this.save({ unreadCount: 0 });
                var conversationId = this.id;
                F.Notifications.remove(F.Notifications.where({
                    conversationId: conversationId
                }));

                this.getUnread().then(function(unreadMessages) {
                    var read = unreadMessages.map(function(m) {
                        if (this.messageCollection.get(m.id)) {
                            m = this.messageCollection.get(m.id);
                        }
                        m.markRead();
                        return {
                            sender    : m.get('source'),
                            timestamp : m.get('sent_at')
                        };
                    }.bind(this));
                    if (read.length > 0) {
                        console.log('Sending', read.length, 'read receipts');
                        textsecure.messaging.syncReadMessages(read);
                    }
                }.bind(this));
            }
        },

        fetchMessages: function(limit) {
            if (!this.id) {
                return false;
            }
            return this.messageCollection.fetchConversation(this.id, limit);
        },

        fetchContacts: async function(options) {
            if (this.isPrivate()) {
                this.contactCollection.reset([this]);
            } else {
                const contacts = (this.get('members') || []).map(id =>
                    this.collection.add({id, type: 'private'}, {merge: true}));
                return await Promise.all(contacts.map(x => x.fetch({not_found_error: false})));
                this.contactCollection.reset(contacts);
            }
        },

        destroyMessages: function() {
            this.messageCollection.fetch({
                index: {
                    // 'conversation' index on [conversationId, received_at]
                    name  : 'conversation',
                    lower : [this.id],
                    upper : [this.id, Number.MAX_VALUE],
                }
            }).then(function() {
                var models = this.messageCollection.models;
                this.messageCollection.reset([]);
                _.each(models, function(message) { message.destroy(); });
                this.save({lastMessage: null, timestamp: null}); // archive
            }.bind(this));
        },

        getName: function() {
            if (this.isPrivate()) {
                return this.get('name');
            } else {
                return this.get('name') || 'Unknown group';
            }
        },

        getTitle: function() {
            if (this.isPrivate()) {
                return this.get('name') || this.id;
            } else {
                return this.get('name') || 'Unknown group';
            }
        },

        getNumber: function() {
            if (!this.isPrivate()) {
                return '';
            }
            return this.id;
        },

        isPrivate: function() {
            return this.get('type') === 'private';
        },

        revokeAvatarUrl: function() {
            if (this.avatarUrl) {
                URL.revokeObjectURL(this.avatarUrl);
                this.avatarUrl = null;
            }
        },

        updateAvatarUrl: function(silent) {
            this.revokeAvatarUrl();
            var avatar = this.get('avatar');
            if (avatar) {
                this.avatarUrl = URL.createObjectURL(
                    new Blob([avatar.data], {type: avatar.contentType})
                );
            } else {
                this.avatarUrl = null;
            }
            if (!silent) {
                this.trigger('change');
            }
        },

        getColor: function() {
            const color = this.get('color');
            /* Only accept custom colors that match our palette. */
            if (!color || COLORS.indexOf(color) === -1) {
                 return COLORS[this.hashCode() % COLORS.length];
            }
            return color;
        },

        getAvatar: function() {
            if (this.avatarUrl === undefined) {
                this.updateAvatarUrl(true);
            }
            var title = this.get('name');
            if (title) {
                const names = title.trim().split(/[\s\-,]+/);
                if (names.length > 1) {
                    title = names[0][0] + names[names.length - 1][0];
                } else {
                    title = names[0][0];
                }
            } else {
                title = '?';
            }
            var color = this.getColor();
            if (this.avatarUrl) {
                return {
                    url: this.avatarUrl,
                    color: color
                };
            } else if (this.isPrivate()) {
                return {
                    color: color,
                    content: title
                };
            } else {
                return {
                    url: F.urls.static + 'images/group_default.png',
                    color: color
                };
            }
        },

        getNotificationIcon: async function() {
            var avatar = this.getAvatar();
            if (avatar.url) {
                return avatar.url;
            } else if (self.Whisper && Whisper.IdenticonSVGView) {
                return await new Whisper.IdenticonSVGView(avatar).getDataUrl();
            }
        },

        resolveConflicts: function(conflict) {
            var number = conflict.number;
            var identityKey = conflict.identityKey;
            if (this.isPrivate()) {
                number = this.id;
            } else if (!_.include(this.get('members'), number)) {
                throw new Error('Tried to resolve conflicts for unknown group member');
            }

            if (!this.messageCollection.hasKeyConflicts()) {
                throw new Error('No conflicts to resolve');
            }

            return textsecure.store.removeIdentityKey(number).then(function() {
                return textsecure.store.saveIdentity(number, identityKey).then(function() {
                    var promise = Promise.resolve();
                    var conflicts = this.messageCollection.filter(function(message) {
                        return message.hasKeyConflict(number);
                    });
                    // group incoming & outgoing
                    conflicts = _.groupBy(conflicts, function(m) { return m.get('type'); });
                    // sort each group by date and concatenate outgoing after incoming
                    conflicts = _.flatten([
                        _.sortBy(conflicts.incoming, function(m) { return m.get('received_at'); }),
                        _.sortBy(conflicts.outgoing, function(m) { return m.get('received_at'); }),
                    ]).forEach(function(message) {
                        var resolveConflict = function() {
                            return message.resolveConflict(number);
                        };
                        promise = promise.then(resolveConflict, resolveConflict);
                    });
                    return promise;
                }.bind(this));
            }.bind(this));
        },

        notify: function(message) {
            if (!message.isIncoming()) {
                return;
            }
            /* Just notify if we are a service worker (ie. !document) */
            if (self.document && !document.hidden) {
                return;
            }
            var sender = this.collection.add({
                id: message.get('source'), type: 'private'
            }, {merge: true});
            var conversationId = this.id;
            sender.fetch().then(function() {
                sender.getNotificationIcon().then(function(iconUrl) {
                    F.Notifications.add({
                        title          : sender.getTitle(),
                        message        : message.getNotificationText(),
                        iconUrl        : iconUrl,
                        imageUrl       : message.getImageUrl(),
                        conversationId : conversationId,
                        messageId      : message.id
                    });
                });
            });
        },

        hashCode: function() {
            if (this._hash === undefined) {
                this._hash = parseInt(md5(this.getTitle()).substr(0, 10), 16);
            }
            return this._hash;
        }
    });

    F.ConversationCollection = Backbone.Collection.extend({
        database: F.Database,
        storeName: 'conversations',
        model: F.Conversation,

        comparator: function(m) {
            return -m.get('timestamp');
        },

        destroyAll: function () {
            return Promise.all(this.models.map(function(m) {
                return new Promise(function(resolve, reject) {
                    m.destroy().then(resolve).fail(reject);
                });
            }));
        },

        search: async function(query) {
            query = query.trim().toLowerCase();
            if (query.length > 0) {
                query = query.replace(/[-.\(\)]*/g,'').replace(/^\+(\d*)$/, '$1');
                var lastCharCode = query.charCodeAt(query.length - 1);
                var nextChar = String.fromCharCode(lastCharCode + 1);
                var upper = query.slice(0, -1) + nextChar;
                try {
                    this.fetch({
                        index: {
                            name: 'search', // 'search' index on tokens array
                            lower: query,
                            upper: upper,
                            excludeUpper: true
                        }
                    });
                } catch(e) {
                    if (e.message !== 'Not Found') {
                        throw e;
                    }
                    return false;
                }
                return true;
            } else {
                return false;
            }
        },

        fetchAlphabetical: async function() {
            try {
                await this.fetch({
                    index: {
                        name: 'search', // 'search' index on tokens array
                    },
                    limit: 100
                });
            } catch(e) {
                if (e.message !== 'Not Found') {
                    throw e;
                }
                return false;
            }
            return true;
        },

        fetchGroups: async function(number) {
            try {
                await this.fetch({
                    index: {
                        name: 'group',
                        only: number
                    }
                });
            } catch(e) {
                if (e.message !== 'Not Found') {
                    throw e;
                }
                return false;
            }
            return true;
        },

        fetchActive: function() {
            // Ensures all active conversations are included in this collection,
            // and updates their attributes, but removes nothing.
            return this.fetch({
                index: {
                    name: 'inbox', // 'inbox' index on active_at
                    order: 'desc'  // ORDER timestamp DESC
                    // TODO pagination/infinite scroll
                    // limit: 10, offset: page*10,
                },
                remove: false
            });
        },

        findOrCreatePrivateById: async function(id) {
            var conversation = this.add({id, type: 'private'});
            try {
                await conversation.fetch();
            } catch(e) {
                if (e.message !== 'Not Found') {
                    throw e;
                }
                await conversation.save();
            }
            return conversation;
        }
    });

    F.InboxCollection = Backbone.Collection.extend({
        initialize: function() {
            this.on('change:timestamp change:name change:number', this.sort);
        },

        comparator: function(m1, m2) {
            var timestamp1 = m1.get('timestamp');
            var timestamp2 = m2.get('timestamp');
            if (timestamp1 && timestamp2) {
                return timestamp2 - timestamp1;
            }
            if (timestamp1) {
                return -1;
            }
            if (timestamp2) {
                return 1;
            }
            var title1 = m1.getTitle().toLowerCase();
            var title2 = m2.getTitle().toLowerCase();
            if (title1 ===  title2) {
                return 0;
            }
            if (title1 < title2) {
                return -1;
            }
            if (title1 > title2) {
                return 1;
            }
        },

        addActive: function(model) {
            if (model.get('active_at')) {
                this.add(model);
            } else {
                this.remove(model);
            }
        }
    });

    F.Conversation.COLORS = COLORS.join(' ');
})();
