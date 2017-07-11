// vim: ts=4:sw=4:expandtab
/* global md5 */

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
        requiredAttrs: new F.util.ESet(['id', 'type', 'recipients', 'users']),

        defaults: function() {
            return {
                unreadCount: 0
            };
        },

        initialize: function() {
            this.messageCollection = new F.MessageCollection([], {
                conversation: this
            });
            this.on('change:avatar', this.updateAvatarUrl);
            this.on('destroy', this.revokeAvatarUrl);
            this.on('read', this.onReadMessage);
            this._messageSender = F.foundation.getMessageSender();
            for (const r of this.get('recipients')) {
                textsecure.store.on('keychange:' + r, () => this.addKeyChange(r));
            }
        },

        addKeyChange: async function(id) {
            debugger; // Did this work? Marvelous!
            await this.messageCollection.create({
                conversationId: this.id,
                type: 'keychange',
                sent_at: this.get('timestamp'),
                received_at: this.get('timestamp'),
                key_changed: id
            });
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

        validate: function(attributes) {
            const keys = new F.util.ESet(Object.keys(attributes));
            const missing = this.requiredAttrs.difference(keys);
            if (missing.size) {
                return "Conversation missing required attributes: " + Array.from(missing).join();
            }
            if (attributes.type !== 'private' && attributes.type !== 'group') {
                return "Invalid conversation type: " + attributes.type;
            }
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

        createBody: function(props) {
            /* Create Forsta msg exchange v1: https://goo.gl/N9ajEX */
            const data = {};
            const body = [{
                type: 'text/plain',
                value: props.plain
            }];
            if (props.html && props.html !== props.plain) {
                body.push({
                    type: 'text/html',
                    value: props.html
                });
            }
            data.body = body;
            if (props.attachments && props.attachments.length) {
                data.attachments = props.attachments.map(x => ({
                    name: x.contentName, // XXX matt
                    size: x.contentSize, // XXX matt
                    type: x.contentType, // XXX matt
                    mtime: x.asdfasdf // XXX
                }));
            }
            return [{
                version: 1,
                type: 'ordinary',
                threadId: this.id,
                threadTitle: this.get('name'),
                userAgent,
                data,
                sendTime: (new Date(props.now)).toISOString(),
            }];
        },

        sendMessage: function(plain, html, attachments) {
            return this.queueJob(async function() {
                var now = Date.now();
                var message = this.messageCollection.add({
                    plain,
                    html,
                    conversationId: this.id,
                    type: 'outgoing',
                    attachments,
                    sent_at: now,
                    received_at: now,
                    expireTimer: this.get('expireTimer')
                });
                const bg = [];
                bg.push(message.save());
                bg.push(this.save({
                    unreadCount: 0,
                    active_at: now,
                    timestamp: now,
                    lastMessage: message.getNotificationText()
                }));
                const msg = JSON.stringify(this.createBody({plain, html, attachments, now}));
                let dest;
                let sender;
                if (this.get('type') == 'private') {
                    dest = this.get('recipients')[0];
                    sender = this._messageSender.sendMessageToNumber;
                } else {
                    dest = this.get('groupId');
                    sender = this._messageSender.sendMessageToGroup;
                }
                bg.push(message.send(sender(dest, msg, attachments, now,
                                            this.get('expireTimer'))));
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

        addExpirationTimerUpdate: async function(expireTimer, source, received_at) {
            received_at = received_at || Date.now();
            this.save({expireTimer});
            const message = this.messageCollection.add({
                conversationId: this.id,
                type: 'outgoing',
                sent_at: received_at,
                received_at,
                flags: textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE,
                expirationTimerUpdate: {expireTimer, source}
            });
            await message.save();
            return message;
        },

        sendExpirationTimerUpdate: async function(time) {
            const number = await F.state.get('number');
            const message = await this.addExpirationTimerUpdate(time, number);
            let sendFunc;
            if (this.get('type') === 'private') {
                sendFunc = this._messageSender.sendExpirationTimerUpdateToNumber;
            } else {
                sendFunc = this._messageSender.sendExpirationTimerUpdateToGroup;
            }
            await message.send(sendFunc(this.get('id'), this.get('expireTimer'),
                               message.get('sent_at')));
        },

        isSearchable: function() {
            return !this.get('left') || !!this.get('lastMessage');
        },

        endSession: async function() {
            if (this.isPrivate()) {
                const now = Date.now();
                const message = this.messageCollection.add({
                    conversationId: this.id,
                    type: 'outgoing',
                    sent_at: now,
                    received_at: now,
                    flags: textsecure.protobuf.DataMessage.Flags.END_SESSION
                });
                await message.save();
                await message.send(this._messageSender.closeSession(this.id, now));
            }
        },

        updateGroup: async function(group_update) {
            if (this.isPrivate()) {
                throw new Error("Called update group on private conversation");
            }
            if (group_update === undefined) {
                group_update = this.pick(['name', 'avatar', 'recipients']);
            }
            const now = Date.now();
            const message = this.messageCollection.add({
                conversationId: this.id,
                type: 'outgoing',
                sent_at: now,
                received_at: now,
                group_update
            });
            await message.save();
            await message.send(this._messageSender.updateGroup(this.id, this.get('name'),
                this.get('avatar'), this.get('recipients')));
        },

        leaveGroup: async function() {
            var now = Date.now();
            if (this.get('type') === 'group') {
                await this.save({left: true});
                const message = this.messageCollection.add({
                    group_update: {left: 'You'},
                    conversationId: this.id,
                    type: 'outgoing',
                    sent_at: now,
                    received_at: now
                });
                await message.save();
                await message.send(this._messageSender.leaveGroup(this.id));
            }
        },

        markRead: async function() {
            if (this.get('unreadCount') > 0) {
                await this.save({unreadCount: 0});
                F.Notifications.remove(F.Notifications.where({conversationId: this.id}));
                const unreadMessages = await this.getUnread();
                const read = unreadMessages.map(m => {
                    if (this.messageCollection.get(m.id)) {
                        // XXX What now?
                        m = this.messageCollection.get(m.id);
                    }
                    m.markRead();
                    return {
                        sender: m.get('source'),
                        timestamp: m.get('sent_at')
                    };
                });
                if (read.length > 0) {
                    console.info('Sending', read.length, 'read receipts');
                    await this._messageSender.syncReadMessages(read);
                }
            }
        },

        fetchMessages: function(limit) {
            if (!this.id) {
                return false;
            }
            return this.messageCollection.fetchConversation(this.id, limit);
        },

        destroyMessages: async function() {
            await this.messageCollection.fetch({
                index: {
                    // 'conversation' index on [conversationId, received_at]
                    name  : 'conversation',
                    lower : [this.id],
                    upper : [this.id, Number.MAX_VALUE],
                }
            });
            const models = this.messageCollection.models;
            this.messageCollection.reset([]);
            await Promise.all(models.map(m => m.destroy()));
            await this.save({lastMessage: null});
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
            if (!_.include(this.get('recipients'), number)) {
                throw new Error('Tried to resolve conflicts for unknown group member');
            }
            if (!this.messageCollection.hasKeyConflicts()) {
                throw new Error('No conflicts to resolve');
            }
            return textsecure.store.removeIdentityKey(number).then(function() {
                return textsecure.store.saveIdentity(number, identityKey).then(function() {
                    let promise = Promise.resolve();
                    let conflicts = this.messageCollection.filter(function(message) {
                        return message.hasKeyConflict(number);
                    });
                    // group incoming & outgoing
                    conflicts = _.groupBy(conflicts, function(m) { return m.get('type'); });
                    // sort each group by date and concatenate outgoing after incoming
                    _.flatten([
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
                id: message.get('source'),
                type: 'private'
            }, {merge: true});
            var conversationId = this.id;
            sender.fetch().then(function() {
                sender.getNotificationIcon().then(function(iconUrl) {
                    F.Notifications.add({
                        title: sender.getTitle(),
                        message: message.getNotificationText(),
                        iconUrl: iconUrl,
                        imageUrl: message.getImageUrl(),
                        conversationId,
                        messageId: message.id
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

        destroyAll: async function () {
            await Promise.all(this.models.map(m => m.destroy()));
        },

        search: async function(query) {
            query = query.trim().toLowerCase();
            if (query.length > 0) {
                query = query.replace(/[-.()]*/g,'').replace(/^\+(\d*)$/, '$1');
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

        findOrCreatePrivateByNumber: async function(id) {
            debugger;
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
        },

        create: async function(attrs, options) {
            if (!attrs.id) {
                attrs.id = F.util.uuid4();
            }
            if (!attrs.type) {
                attrs.type = attrs.users.length === 1 ? 'private' : 'group';
            }
            attrs.active_at = Date.now();
            attrs.unreadCount = 0;
            if (attrs.recipients) {
                /* Ensure our number is not in the recipients. */
                const numbers = new Set(attrs.recipients);
                numbers.delete(await F.state.get('number'));
                attrs.recipients = Array.from(numbers);
            }
            if (attrs.users) {
                /* Ensure our user is not in the recipients. */
                const users = new Set(attrs.users);
                users.delete((await F.ccsm.getUserProfile()).id);
                attrs.users = Array.from(users);
            }
            if (!attrs.recipients && !attrs.users) {
                throw new Error("Required props missing: users or recipients must be provided");
            }
            if (!attrs.recipients) {
                console.warn("Convo-create: Supplementing recipients from users");
                const users = F.foundation.getUsers();
                attrs.recipients = attrs.users.map(x => users.get(x).get('phone'));
                if (attrs.recipients.indexOf(undefined) !== -1) {
                    throw new Error('Invalid user detected');
                }
            } else if (!attrs.users) {
                console.warn("Convo-create: Supplementing users from recipients");
                const users = F.foundation.getUsers();
                attrs.users = attrs.recipients.map(x => users.findWhere({phone: x}).id);
                if (attrs.users.indexOf(undefined) !== -1) {
                    throw new Error('Invalid phone number detected');
                }
            }
            if (attrs.type === 'group' && !attrs.groupId) {
                const ms = F.foundation.getMessageSender();
                attrs.groupId = await ms.createGroup(attrs.recipients, attrs.name);
                console.info(`Created group ${attrs.groupId} for conversation ${attrs.id}`);
            }
            debugger; // XXX make sure create returns promise.
            return await Backbone.Collection.prototype.create.call(this, attrs, options);
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
