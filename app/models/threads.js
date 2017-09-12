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
        validTypes: new Set(['conversation', 'announcement']),

        defaults: function() {
            return {
                unreadCount: 0,
                timestamp: Date.now()
            };
        },

        initialize: function(attrs) {
            this.messages = new F.MessageCollection([], {
                thread: this
            });
            this.on('read', this.onReadMessage);
            this.on('change:distribution', this.onDistributionChange);
            if (attrs.distribution && !attrs.titleFallback) {
                this.onDistributionChange(this, attrs.distribution);
            }
            this.messageSender = F.foundation.getMessageSender();
            this.getMembers().then(id => {
                textsecure.store.on('keychange:' + id, () => this.addKeyChange(id));
            });
        },

        onDistributionChange: function(_, distribution) {
            /* Create a normalized rendition of our distribution title. */
            const ourTag = F.currentUser.get('tag').id;
            F.queueAsync(this.id + 'onDistributionChange', (async function() {
                let title;
                let dist = await F.ccsm.resolveTags(distribution);
                if (dist.includedTagids.indexOf(ourTag) !== -1) {
                    // Remove direct reference to our tag.
                    dist = await F.ccsm.resolveTags(`(${distribution}) - <${ourTag}>`);
                    if (!dist.universal) {
                        // No one besides ourself.
                        title = `<span title="@${F.currentUser.getSlug()}">[You]</span>`;
                    }
                }
                if (!title && dist.userids.length === 1 && dist.includedTagids.length === 1) {
                    // A 1:1 convo with a users tag.  Use their formal name.
                    const user = await F.ccsm.userLookup(dist.userids[0]);
                    if (user.get('tag').id === dist.includedTagids[0]) {
                        title = `<span title="@${user.getSlug()}">${user.getName()}</span>`;
                    }
                }
                if (!title) {
                    title = dist.pretty;
                }
                await this.save({
                    titleFallback: title,
                    distributionPretty: dist.pretty
                });
            }).bind(this));
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

        _createExchange: function(message, data, threadType, messageType) {
            /* Create Forsta msg exchange v1: https://goo.gl/N9ajEX */
            return [{
                version: 1,
                threadType: threadType || this.get('type'),
                messageType: messageType || message.get('type'),
                messageId: message.id,
                threadId: this.id,
                threadTitle: this.get('title'),
                userAgent,
                data,
                sendTime: (new Date(message.get('sent') || Date.now())).toISOString(),
                sender: {
                    userId: F.currentUser.id
                },
                distribution: {
                    expression: this.get('distribution')
                }
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
            return this._createExchange(message, controlData, null, 'control');
        },

        createMessage: async function(attrs) {
            /* Create and save a well-formed outgoing message for this thread. */
            const ourId = F.currentUser.id;
            const members = attrs.type !== 'clientOnly' ? await this.getMembers() : [ourId];
            const now = Date.now();
            const full_attrs = Object.assign({
                id: F.util.uuid4(), // XXX Make this a uuid5 hash.
                sender: ourId,
                members,
                userAgent,
                threadId: this.id,
                type: 'content',
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
                await msg.send(this.messageSender.sendMessageToAddrs(msg.get('members'),
                    exchange, attachments, msg.get('sent'), msg.get('expiration')));
            }.bind(this));
        },

        addExpirationUpdate: async function(expiration, source, received) {
            this.set({expiration});
            const ts = received || Date.now();
            return await this.createMessage({
                incoming: !!received,
                type: 'control',
                sent: ts,
                received: ts,
                flags: textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE,
                expirationUpdate: {expiration, source}
            });
        },

        sendExpirationUpdate: async function(time) {
            const us = await F.state.get('addr');
            const msg = await this.addExpirationUpdate(time, us);
            await msg.send(this.messageSender.sendExpirationUpdateToAddrs(msg.get('members'),
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
            for (const id of await this.getMembers()) {
                await msg.send(this.messageSender.closeSession(id, msg.get('sent')));
            }
        },

        modifyThread: async function(updates) {
            // XXX this is a dumpster fire...
            if (updates === undefined) {
                updates = this.pick(['title', 'distribution']);
            } else {
                await this.save(updates);
            }
            //const msg = await this.createMessage({thread_update: updates});
            //await msg.send(this.messageSender.updateGroup(this.id, updates));
            console.error("UNPORTED");
        },

        leaveThread: async function(close) {
            // XXX this is a dumpster fire...
            this.set({left: true});
            //const us = await F.state.get('addr');
            //const msg = await this.createMessage({thread_update: {left: [us]}});
            //await msg.send(this.messageSender.leaveGroup(this.id));
            console.error("UNPORTED");
        },

        markRead: async function() {
            if (this.get('unreadCount') > 0) {
                await this.save({unreadCount: 0});
                F.notifications.remove(F.notifications.where({threadId: this.id}));
                /* Note, do not combine the markRead calls.  They must be seperate to avoid
                 * dubious read values. */
                const unread = this.messages.where({read: 0});
                await Promise.all(unread.map(x => x.markRead()));
                /* Handle unpaged models too (but only after in-mem ones!)... */
                const dbUnread = (await this.fetchUnread()).models;
                await Promise.all(dbUnread.map(x => x.markRead()));
                const reads = unread.concat(dbUnread).map(m => ({
                    sender: m.get('source'),
                    timestamp: m.get('sent')
                }));
                await this.messageSender.syncReadMessages(reads);
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

        getColor: function() {
            const color = this.get('color');
            /* Only accept custom colors that match our palette. */
            if (!color || F.theme_colors.indexOf(color) === -1) {
                return F.util.pickColor(this.id);
            }
            return color;
        },

        getAvatar: async function() {
            const members = new Set(await this.getMembers());
            members.delete(F.currentUser.id);
            if (members.size === 0) {
                return await F.currentUser.getAvatar();
            } else if (members.size === 1) {
                const them = await F.ccsm.userLookup(Array.from(members)[0]);
                return await them.getAvatar();
            } else {
                const sample = await F.ccsm.userDirectoryLookup(Array.from(members).slice(0, 4));
                return {
                    color: this.getColor(),
                    group: await Promise.all(sample.map(u => u.getAvatar())),
                    groupSize: members.size + 1
                };
            }
        },

        getMembers: async function() {
            const dist = this.get('distribution');
            if (!dist) {
                throw new ReferenceError("Misssing message `distribution`");
            }
            return (await F.ccsm.resolveTags(dist)).userids;
        },

        getMemberCount: async function() {
            return (await this.getMembers()).length;
        },

        notify: async function(message) {
            if (!message.get('incoming') ||
                (self.document && !document.hidden) ||
                this.notificationsMuted()) {
                return;
            }
            F.notifications.add({
                id: message.id,
                threadId: message.get('threadId'),
                message
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
        },

        getNormalizedTitle: function() {
            return this.get('title') || this.get('titleFallback');
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

        fetchOrdered: async function(limit) {
            return await this.fetch({
                limit,
                index: {
                    name: 'timestamp'
                }
            });
        },

        normalizeDistribution: async function(expression) {
            let dist = await F.ccsm.resolveTags(expression);
            if (!dist.universal) {
                throw new Error("Invalid or empty expression");
            }
            if (dist.userids.indexOf(F.currentUser.id) === -1) {
                // Add ourselves to the group implicitly since the expression
                // didn't have a tag that included us.
                const ourTag = F.currentUser.getSlug();
                return await F.ccsm.resolveTags(`(${dist.universal}) + @${ourTag}`);
            } else {
                return dist;
            }
        },

        make: async function(expression, attrs) {
            const dist = await this.normalizeDistribution(expression);
            attrs = attrs || {};
            attrs.distribution = dist.universal;
            if (!attrs.type) {
                attrs.type = 'conversation';
            }
            if (!attrs.id) {
                attrs.id = F.util.uuid4();
            }
            return await this.create(attrs);
        },

        ensure: async function(expression, attrs) {
            const dist = await this.normalizeDistribution(expression);
            const filter = {distribution: dist.universal};
            attrs = attrs || {};
            if (attrs.type) {
                filter.type = attrs.type;
            }
            const thread = this.findWhere(filter);
            if (thread) {
                // Bump the timestamp given the interest level change.
                await thread.save({timestamp: Date.now()});
            }
            return thread || await this.make(expression, attrs);
        }
    });
})();
