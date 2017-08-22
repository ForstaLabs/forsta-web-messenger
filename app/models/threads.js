// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    const userAgent = [
        `${F.product}/${F.version}`,
        `(${forsta_env.GIT_COMMIT.substring(0, 10)})`,
        navigator.userAgent
    ].join(' ');

    F.Thread = Backbone.Model.extend({
        database: F.Database,
        storeName: 'threads',
        requiredAttrs: new F.util.ESet(['id', 'type', 'distribution']),
        validTypes: new Set(['conversation', 'poll', 'announcement']),

        defaults: function() {
            return {
                unreadCount: 0,
                timestamp: Date.now()
            };
        },

        initialize: function() {
            this.messages = new F.MessageCollection([], {
                thread: this
            });
            this.on('change:avatar', this.updateAvatarUrl);
            this.on('destroy', this.revokeAvatarUrl);
            this.on('read', this.onReadMessage);
            const ms = this._messageSender = F.foundation.getMessageSender();
            this._sendMessageTo = ms.sendMessageToAddrs;
            this._sendExpireUpdateTo = ms.sendExpirationUpdateToAddrs;
            this.getUsers().then(user => {
                textsecure.store.on('keychange:' + user, () => this.addKeyChange(user));
            });
        },

        addMessage: function(message) {
            console.assert(message instanceof F.Message);
            const ret = this.messages.add(message);
            if (!message.get('read')) {
                this.notify(message);
            }
            return ret;
        },

        addKeyChange: async function(sender) {
            return await this.createMessage({
                sender,
                type: 'keychange',
                sent: this.get('timestamp'),
                received: this.get('timestamp'),
                key_changed: sender
            });
        },

        onReadMessage: async function(message) {
            const unread = await this.fetchUnread();
            await this.save({unreadCount: unread.length});
        },

        fetchUnread: async function() {
            const unread = new F.MessageCollection(); // Avoid rendering attached views.
            await unread.fetch({
                index: {
                    name: 'threadId-read',
                    lower: [this.id, 0],
                    upper: [this.id, 0],
                }
            });
            return unread;
        },

        validate: function(attrs) {
            const keys = new F.util.ESet(Object.keys(attrs));
            const missing = this.requiredAttrs.difference(keys);
            if (missing.size) {
                throw new Error("Thread missing required attributes: " +
                                Array.from(missing).join(', '));
            }
            if (!this.validTypes.has(attrs.type)) {
                throw new TypeError("Invalid type: " + attrs.type);
            }
        },

        _createExchange: function(message, data, type) {
            /* Create Forsta msg exchange v1: https://goo.gl/N9ajEX */
            type = type || this.get('type');
            return [{
                version: 1,
                type,
                messageId: message.id,
                threadId: this.id,
                threadTitle: this.get('title'),
                userAgent,
                data,
                sendTime: (new Date(message.get('sent') || Date.now())).toISOString(),
                sender: {
                    userId: F.currentUser.id
                },
                distribution: this.get('distribution')
            }];
        },

        createMessageExchange: function(message) {
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
            return this._createExchange(message, data);
        },

        createControlExchange: function(message, controlData) {
            return this._createExchange(message, controlData, 'control');
        },

        createMessage: async function(attrs) {
            /* Create and save a well-formed outgoing message for this thread. */
            const now = Date.now();
            let destination;
            if (!attrs.type || attrs.type === 'outgoing') {
                destination = await this.getUsers();
            }
            const full_attrs = Object.assign({
                id: F.util.uuid4(), // XXX Make this a uuid5 hash.
                sender: F.currentUser.id,
                userAgent,
                destination,
                threadId: this.id,
                type: 'outgoing',
                sent: now,
                expiration: this.get('expiration')
            }, attrs);
            if (!full_attrs.received) {
                // Our thread index is based on received; Make sure someone set it.
                full_attrs.received = now;
            }
            const msg = this.messages.add(full_attrs);
            await msg.save();
            await this.save({
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
                const exchange = this.createMessageExchange(msg);
                await msg.send(this._sendMessageTo(msg.get('destination'), exchange,
                    attachments, msg.get('sent'), msg.get('expiration')));
            }.bind(this));
        },

        addExpirationUpdate: async function(expiration, source, received) {
            this.set({expiration});
            const ts = received || Date.now();
            return await this.createMessage({
                type: received ? 'incoming' : 'outgoing',
                sent: ts,
                received: ts,
                flags: textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE,
                expirationUpdate: {expiration, source}
            });
        },

        sendExpirationUpdate: async function(time) {
            const us = await F.state.get('addr');
            const msg = await this.addExpirationUpdate(time, us);
            await msg.send(this._sendExpireUpdateTo(msg.get('destination'),
                msg.get('expiration'), msg.get('sent')));
        },

        isSearchable: function() {
            return !this.get('left') || !!this.get('lastMessage');
        },

        endSession: async function() {
            // XXX this is a dumpster fire...
            const msg = await this.createMessage({
                flags: textsecure.protobuf.DataMessage.Flags.END_SESSION
            });
            for (const user of await this.getUsers()) {
                await msg.send(this._messageSender.closeSession(user, msg.get('sent')));
            }
        },

        modifyThread: async function(thread_update) {
            // XXX this is a dumpster fire...
            if (thread_update === undefined) {
                thread_update = this.pick(['title', 'avatar', 'distribution']);
            } else {
                for (const key of Object.keys(thread_update)) {
                    this.set(key, thread_update[key]);
                }
            }
            //const msg = await this.createMessage({thread_update});
            //await msg.send(this._messageSender.updateGroup(this.id, thread_update));
            console.error("UNPORTED");
        },

        leaveThread: async function(close) {
            // XXX this is a dumpster fire...
            this.set({left: true});
            //const us = await F.state.get('addr');
            //const msg = await this.createMessage({thread_update: {left: [us]}});
            //await msg.send(this._messageSender.leaveGroup(this.id));
            console.error("UNPORTED");
        },

        markRead: async function() {
            if (this.get('unreadCount') > 0) {
                await this.save({unreadCount: 0});
                F.notifications.remove(F.notifications.where({threadId: this.id}));
                const unread = await this.fetchUnread();
                const reads = unread.map(m => {
                    m.markRead();
                    return {
                        sender: m.get('source'),
                        timestamp: m.get('sent')
                    };
                });
                await this._messageSender.syncReadMessages(reads);
            }
        },

        fetchMessages: function(limit) {
            if (!this.id) {
                return false;
            }
            return this.messages.fetchPage(limit);
        },

        destroyMessages: async function() {
            this.messages.reset([]); // Get view rerender going first.
            /* NOTE: Must not use this.messages as it is bound
             * to various views and will lazily render models that get
             * fetched even after we destroy them. */
            const messages = new F.MessageCollection([], {
                thread: this
            });
            await messages.fetchAll();
            await messages.destroyAll();
            await this.save({lastMessage: null});
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

        getColor: async function() {
            const color = this.get('color');
            /* Only accept custom colors that match our palette. */
            if (!color || F.theme_colors.indexOf(color) === -1) {
                return F.util.pickColor(this.id);
            }
            return color;
        },

        getAvatar: async function() {
            const allUsers = F.foundation.getUsers();
            if (!this.avatarUrl) {
                this.updateAvatarUrl(/*silent*/ true);
            }
            if (this.avatarUrl) {
                return {
                    color: await this.getColor(),
                    url: this.avatarUrl
                };
            } else if ((await this.getUsers()).length <= 2) {
                const users = new Set(await this.getUsers());
                if (!users.size) {
                    console.error("Corrupt thread (has no users):", this);
                } else {
                    users.delete(F.currentUser.id);
                    const them = allUsers.get(Array.from(users)[0]);
                    return await them.getAvatar();
                }
            } else {
                const users = new Set(await this.getUsers());
                users.delete(F.currentUser.id);
                const someUsers = Array.from(users).slice(0, 4);
                return {
                    color: await this.getColor(),
                    group: (await Promise.all(someUsers.map(u => allUsers.get(u).getAvatar()))),
                    groupSize: users.size + 1
                };
            }
        },

        getUsers: async function() {
            const dist = this.get('distribution');
            return (await F.ccsm.resolveTags(dist)).userids;
        },

        getUserCount: async function() {
            return (await this.getUsers()).length;
        },

        resolveConflicts: async function(conflict) {
            var addr = conflict.addr;
            var identityKey = conflict.identityKey;
            if (!_.include(await this.getUsers(), addr)) {
                throw new Error('Tried to resolve conflicts for unknown group member');
            }
            if (!this.messages.hasKeyConflicts()) {
                throw new Error('No conflicts to resolve');
            }
            return textsecure.store.removeIdentityKey(addr).then(function() {
                return textsecure.store.saveIdentity(addr, identityKey).then(function() {
                    let promise = Promise.resolve();
                    let conflicts = this.messages.filter(function(message) {
                        return message.hasKeyConflict(addr);
                    });
                    // group incoming & outgoing
                    conflicts = _.groupBy(conflicts, function(m) { return m.get('type'); });
                    // sort each group by date and concatenate outgoing after incoming
                    _.flatten([
                        _.sortBy(conflicts.incoming, function(m) { return m.get('received'); }),
                        _.sortBy(conflicts.outgoing, function(m) { return m.get('received'); }),
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
            if (!message.isIncoming() ||
                (self.document && !document.hidden) ||
                this.notificationsMuted()) {
                return;
            }
            const sender = message.getSender();
            const iconUrl = (await sender.getAvatar()).url;
            F.notifications.add({
                title: sender.getName(),
                message: message.getNotificationText(),
                iconUrl,
                imageUrl: message.getImageUrl(),
                threadId: this.id,
                messageId: message.id
            });
        },

        notificationsMuted: function() {
            const mute = this.get('notificationsMute');
            if (typeof mute === 'number') {
                if (mute > Date.now()) {
                    return true;
                } else {
                    // Reset the value since it's past expiration.
                    this.set('notificationsMute', false);
                }
            } else {
                return mute;
            }
        }
    });

    F.ThreadCollection = Backbone.Collection.extend({
        database: F.Database,
        storeName: 'threads',
        model: F.Thread,

        initialize: function() {
            this.on("change:timestamp", this.onReposition);
        },

        comparator: function(m1, m2) {
            const ts1 = m1.get('timestamp');
            const ts2 = m2.get('timestamp');
            return (ts2 || 0) - (ts1 || 0);
        },

        onReposition: function(model) {
            const oldIndex = this.models.indexOf(model);
            this.sort();
            const newIndex = this.models.indexOf(model);
            if (oldIndex !== newIndex) {
                this.trigger('reposition', model, newIndex, oldIndex);
            }
        },

        _lazyget: async function(id) {
            let thread = this.get(id);
            if (!thread) {
                thread = new F.Thread(id);
                try {
                    await thread.fetch();
                } catch(e) {
                    if (e.message !== 'Not Found') {
                        throw e;
                    }
                    thread = undefined;
                }
            }
            return thread;
        },

        findOrCreate: async function(message, type) {
            if (message.get('threadId')) {
                const thread = this._lazyget(message.get('threadId'));
                if (thread) {
                    return thread;
                }
            }
            console.error("XXX Creating new thread without good data.");
            return await this.make({type, distribution: `<${message.get('source')}>`});
        },

        fetchOrdered: async function(limit) {
            return await this.fetch({
                limit,
                index: {
                    name: 'timestamp'
                }
            });
        },

        make: async function(attrs, options) {
            options = options || {};
            if (options.merge === undefined) {
                options.merge = true;
            }
            if (!attrs.id) {
                attrs.id = F.util.uuid4();
                console.warn("Creating new thread:", attrs.id);
            }
            const c = this.add(attrs, options);
            await c.save();
            return c;
        },

    });


    F.TypedThreadCollection = F.ThreadCollection.extend({
        /* Base class for type specific thread collections.  Provides code to keep these typed collections
         * in sync with the parent thread collection. */

        type: undefined,  // Set by subclass

        constructor: function(parent) {
            F.ThreadCollection.prototype.constructor.call(this);
            this.listenTo(parent, 'add', this.onParentAdd);
            this.listenTo(parent, 'remove', this.onParentRemove);
            this.listenTo(parent, 'reset', this.onParentReset);
            this.reset(parent.where({type: this.type}));
        },

        fetchOrdered: async function(limit) {
            return await this.fetch({
                limit,
                index: {
                    name: 'type-timestamp',
                    lower: [this.type],
                    upper: [this.type] //, Number.MAX_VALUE] // XXX can do this?
                }
            });
        },

        onParentAdd: function(model) {
            if (model.get('type') === this.type && !this.get(model.id)) {
                this.add([model]);
            }
        },

        onParentRemove: function(model) {
            if (model.get('type') === this.type) {
                const ourModel = this.get(model.id);
                if (ourModel) {
                    this.remove([ourModel]);
                }
            }
        },

        onParentReset: function(models) {
            debugger;
            this.reset(models.where({type: this.type}));
        },
    });

    F.ConversationCollection = F.TypedThreadCollection.extend({
        type: 'conversation'
    });

    F.PollCollection = F.TypedThreadCollection.extend({
        type: 'poll'
    });

    F.AnnouncementCollection = F.TypedThreadCollection.extend({
        type: 'announcement'
    });
})();
