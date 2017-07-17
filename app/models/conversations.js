// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    const userAgent = [
        `ForstaWeb/${F.version}`,
        `(${forsta_env.GIT_COMMIT.substring(0, 10)})`,
        navigator.userAgent
    ].join(' ');

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
            const ms = this._messageSender = F.foundation.getMessageSender();
            if (this.isPrivate()) {
                this._sendMessageTo = ms.sendMessageToAddr;
                this._sendExpireUpdateTo = ms.sendExpirationTimerUpdateToAddr;
            } else {
                this._sendMessageTo = ms.sendMessageToGroup;
                this._sendExpireUpdateTo = ms.sendExpirationTimerUpdateToGroup;
            }
            for (const r of this.get('recipients')) {
                textsecure.store.on('keychange:' + r, () => this.addKeyChange(r));
            }
        },

        addKeyChange: async function(id) {
            const m = this.messageCollection.add({
                conversationId: this.id,
                type: 'keychange',
                sent_at: this.get('timestamp'),
                received_at: this.get('timestamp'),
                key_changed: id
            });
            await m.save();
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
                    name: 'unread',
                    lower: [this.id],
                    upper: [this.id, Number.MAX_VALUE],
                }
            });
            return unread;
        },

        validate: function(attrs) {
            const keys = new F.util.ESet(Object.keys(attrs));
            const missing = this.requiredAttrs.difference(keys);
            if (missing.size) {
                throw new Error("Conversation missing required attributes: " +
                                Array.from(missing).join(', '));
            }
            if (attrs.type !== 'private' && attrs.type !== 'group') {
                throw new TypeError("Invalid type: " + attrs.type);
            }
            if (attrs.type === 'private') {
                if (attrs.users.length !== 1) {
                    throw new Error("Expected a single user entry");
                }
                if (attrs.recipients.length !== 1) {
                    throw new Error("Expected a single recipients entry");
                }
            }
            if (attrs.recipients.length !== attrs.users.length) {
                throw new Error("Users and recipients list are incongruent");
            }
        },

        createBody: function(message) {
            /* Create Forsta msg exchange v1: https://goo.gl/N9ajEX */
            const props = message.attributes;
            const data = {};
            if (props.safe_html && !props.plain) {
                throw new Error("'safe_html' message provided without 'plain' fallback");
            }
            if (props.plain) {
                const body = [{
                    type: 'text/plain',
                    value: props.plain
                }];
                if (props.safe_html && props.safe_html !== props.plain) {
                    body.push({
                        type: 'text/html',
                        value: props.safe_html
                    });
                }
                data.body = body;
            }
            if (props.attachments && props.attachments.length) {
                data.attachments = props.attachments.map(x => ({
                    name: x.name,
                    size: x.size,
                    type: x.type,
                    mtime: x.mtime
                }));
            }
            return [{
                version: 1,
                type: 'ordinary',
                messageId: message.id,
                threadId: this.id,
                threadTitle: this.get('name'),
                userAgent,
                data,
                sendTime: (new Date(props.sent_at)).toISOString(),
            }];
        },

        createMessage: async function(attrs) {
            /* Create and save a well-formed outgoing message for this conversation. */
            const now = Date.now();
            let destination;
            if (!attrs.type || attrs.type === 'outgoing') {
                if (this.isPrivate()) {
                    console.assert(this.get('recipients').length === 1);
                    destination = this.get('recipients')[0];
                } else {
                    destination = this.id;
                }
            }
            const defaults = {
                id: F.util.uuid4(), // XXX Make this a uuid5 hash.
                destination,
                conversationId: this.id,
                type: 'outgoing',
                sent_at: now,
                expireTimer: this.get('expireTimer')
            };
            const msg = this.messageCollection.add(Object.assign(defaults, attrs));
            await msg.save();
            await this.save({
                active: true,
                timestamp: now,
                lastMessage: msg.getNotificationText()
            });
            return msg;
        },

        sendMessage: function(plain, safe_html, attachments) {
            return F.queueAsync(this, async function() {
                const msg = await this.createMessage({
                    plain,
                    safe_html,
                    attachments
                });
                const body = JSON.stringify(this.createBody(msg));
                await msg.send(this._sendMessageTo(msg.get('destination'), body,
                    attachments, msg.get('sent_at'), msg.get('expireTimer')));
            }.bind(this));
        },

        addExpirationTimerUpdate: async function(expireTimer, source, received_at) {
            this.set({expireTimer});
            return await this.createMessage({
                type: received_at ? 'incoming' : 'outgoing',
                received_at,
                flags: textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE,
                expirationTimerUpdate: {expireTimer, source}
            });
        },

        sendExpirationTimerUpdate: async function(time) {
            const us = await F.state.get('addr');
            const msg = await this.addExpirationTimerUpdate(time, us);
            await msg.send(this._sendExpireUpdateTo(msg.get('destination'),
                msg.get('expireTimer'), msg.get('sent_at')));
        },

        isSearchable: function() {
            return !this.get('left') || !!this.get('lastMessage');
        },

        endSession: async function() {
            if (!this.isPrivate()) {
                throw new Error("End session is only valid for private conversations");
            }
            const msg = await this.createMessage({
                flags: textsecure.protobuf.DataMessage.Flags.END_SESSION
            });
            await msg.send(this._messageSender.closeSession(this.get('recipients')[0],
                                                            msg.get('sent_at')));
        },

        modifyGroup: async function(group_update) {
            if (this.isPrivate()) {
                throw new Error("Called update group on private conversation");
            }
            if (group_update === undefined) {
                group_update = this.pick(['name', 'avatar', 'recipients']);
            } else {
                for (const key of Object.keys(group_update)) {
                    this.set(key, group_update[key]);
                }
            }
            const msg = await this.createMessage({group_update});
            await msg.send(this._messageSender.updateGroup(this.id, group_update));
        },

        leaveGroup: async function() {
            if (!this.get('type') === 'group') {
                throw new TypeError("Only group conversations can be left");
            }
            this.set({left: true});
            const us = await F.state.get('addr');
            const msg = await this.createMessage({group_update: {left: [us]}});
            await msg.send(this._messageSender.leaveGroup(this.id));
        },

        markRead: async function() {
            if (this.get('unreadCount') > 0) {
                await this.save({unreadCount: 0});
                F.Notifications.remove(F.Notifications.where({conversationId: this.id}));
                const unreadMessages = await this.getUnread();
                const read = unreadMessages.map(m => {
                    if (this.messageCollection.get(m.id)) {
                        // Get our instance of the message if we have it.
                        m = this.messageCollection.get(m.id);
                    } else {
                        console.warn("Didn't find message in local collection. Possible BUG");
                    }
                    m.markRead();
                    return {
                        sender: m.get('source'),
                        timestamp: m.get('sent_at')
                    };
                });
                if (read.length > 0) {
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
            this.messageCollection.reset([]); // Get view rerender going first.
            /* NOTE: Must not use this.messageCollection as it is bound
             * to various views and will lazily render models that get
             * fetched even after we destroy them. */
            const messages = new F.MessageCollection([], {
                conversation: this
            });
            await messages.fetch({
                index: {
                    name  : 'conversation',
                    lower : [this.id],
                    upper : [this.id, Number.MAX_VALUE],
                }
            });
            // Must use copy of collection.models to avoid in-place mutation bugs
            // during model.destroy.
            const models = Array.from(messages.models);
            await Promise.all(models.map(m => m.destroy()));
            await this.save({lastMessage: null});
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
            if (!color || F.theme_colors.indexOf(color) === -1) {
                if (this.isPrivate()) {
                    return this.getUsers()[0].getColor();
                } else {
                    return F.util.pickColor(this.id);
                }
            }
            return color;
        },

        getAvatar: function() {
            if (!this.avatarUrl) {
                this.updateAvatarUrl(/*silent*/ true);
            }
            if (this.avatarUrl) {
                return {
                    color: this.getColor(),
                    url: this.avatarUrl
                };
            } else if (this.isPrivate()) {
                return this.getUsers()[0].getAvatar();
            } else {
                return {
                    color: this.getColor(),
                    group: this.getUsers().map(u => u.getAvatar()).slice(0, 4)
                };
            }
        },

        getUsers: function() {
            const users = new Set(this.get('users'));
            return F.foundation.getUsers().filter(u => users.has(u.id));
        },

        getNotificationIcon: async function(sender) {
            let avatar = sender.getAvatar();
            if (avatar.url) {
                return avatar.url;
            } else if (F.IdenticonSVGView) {
                return await new F.IdenticonSVGView(avatar).getDataUrl();
            }
        },

        resolveConflicts: function(conflict) {
            var addr = conflict.addr;
            var identityKey = conflict.identityKey;
            if (!_.include(this.get('recipients'), addr)) {
                throw new Error('Tried to resolve conflicts for unknown group member');
            }
            if (!this.messageCollection.hasKeyConflicts()) {
                throw new Error('No conflicts to resolve');
            }
            return textsecure.store.removeIdentityKey(addr).then(function() {
                return textsecure.store.saveIdentity(addr, identityKey).then(function() {
                    let promise = Promise.resolve();
                    let conflicts = this.messageCollection.filter(function(message) {
                        return message.hasKeyConflict(addr);
                    });
                    // group incoming & outgoing
                    conflicts = _.groupBy(conflicts, function(m) { return m.get('type'); });
                    // sort each group by date and concatenate outgoing after incoming
                    _.flatten([
                        _.sortBy(conflicts.incoming, function(m) { return m.get('received_at'); }),
                        _.sortBy(conflicts.outgoing, function(m) { return m.get('received_at'); }),
                    ]).forEach(function(message) {
                        var resolveConflict = function() {
                            return message.resolveConflict(addr);
                        };
                        promise = promise.then(resolveConflict, resolveConflict);
                    });
                    return promise;
                }.bind(this));
            }.bind(this));
        },

        notify: async function(message) {
            if (!message.isIncoming()) {
                return;
            }
            if (self.document && !document.hidden) {
                return;
            }
            const sender = await message.getSender();
            const iconUrl = this.getNotificationIcon(sender);
            F.Notifications.add({
                title: sender.getName(),
                message: message.getNotificationText(),
                iconUrl,
                imageUrl: message.getImageUrl(),
                conversationId: this.id,
                messageId: message.id
            });
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

        fetchGroups: async function(addr) {
            try {
                await this.fetch({
                    index: {
                        name: 'group',
                        only: addr
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

        _lazyget: async function(id) {
            let convo = this.get(id);
            if (!convo) {
                convo = new F.Conversation(id);
                try {
                    await convo.fetch();
                } catch(e) {
                    if (e.message !== 'Not Found') {
                        throw e;
                    }
                    convo = undefined;
                }
            }
            return convo;
        },

        findOrCreate: async function(message) {
            if (message.get('conversationId')) {
                const convo = this._lazyget(message.get('conversationId'));
                if (convo) {
                    return convo;
                }
            }
            console.error("Creating new conversation without good data.");
            return await this.make({recipients: [message.get('source')]});
        },

        make: async function(attrs, options) {
            const isNew = !attrs.id;
            if (isNew) {
                attrs.id = F.util.uuid4();
                console.info("Creating new conversation:", attrs.id);
            }
            attrs.active = true;
            attrs.timestamp = Date.now();
            attrs.unreadCount = 0;
            if (attrs.recipients) {
                /* Ensure our addr is not in the recipients. */
                const addrs = new Set(attrs.recipients);
                addrs.delete(await F.state.get('addr'));
                attrs.recipients = Array.from(addrs);
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
                const users = F.foundation.getUsers();
                // XXX maybe we want ccsm to store the signal address aside the phone.
                attrs.recipients = attrs.users.map(x => users.get(x).get('phone'));
                if (attrs.recipients.indexOf(undefined) !== -1) {
                    throw new Error('Invalid user detected');
                }
            } else if (!attrs.users) {
                const users = F.foundation.getUsers();
                // XXX maybe we want ccsm to store the signal address aside the phone.
                attrs.users = attrs.recipients.map(x => users.findWhere({phone: x}).id);
                if (attrs.users.indexOf(undefined) !== -1) {
                    throw new Error('Invalid signal address detected');
                }
            }
            if (!attrs.type) {
                attrs.type = attrs.users.length > 1 ? 'group' : 'private';
            }
            if (attrs.type === 'group' && isNew) {
                const ms = F.foundation.getMessageSender();
                console.info("Creating group for:", attrs.id);
                await ms.startGroup(attrs.id, attrs.recipients, attrs.name);
            }
            const c = this.add(attrs, options);
            await c.save();
            return c;
        }
    });

    F.ActiveConversations = Backbone.Collection.extend({
        initialize: function() {
            this.on('change:timestamp', this.sort);
        },

        comparator: function(m1, m2) {
            const ts1 = m1.get('timestamp');
            const ts2 = m2.get('timestamp');
            return (ts2 || 0) - (ts1 || 0);
        },

        onAdd: function(model) {
            if (model.get('active')) {
                this.add(model);
            }
        },

        onRemove: function(model) {
            this.remove(model);
        },

        onChange: function(model) {
            if (model.get('active')) {
                this.add(model);
            } else {
                this.remove(model);
            }
        }
    });
})();
