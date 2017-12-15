// vim: ts=4:sw=4:expandtab
/* global relay Backbone */

(function () {
    'use strict';

    self.F = self.F || {};

    function tagExpressionWarningsToNotice(warnings) {
        /* Convert distribution warning objects to thread notices. */
        if (!warnings.length) {
            return;
        }
        let detailMsg = [];
        var usersRemoved = 0;
        for (const warning in warnings) {
            const isTag = F.atlas.isUniversalTag(warning.cue);
            if (isTag) {
                usersRemoved++;
            } else {
                detailMsg.push(`${warning.kind}: ${escape(warning.context)}`);
            }
        }
        if (usersRemoved === 1) {
            detailMsg.push(`Removed deleted user`);
        } else if (usersRemoved > 1) {
            detailMsg.push(`Removed ${usersRemoved} deleted users`);
        }
        return {
            className: 'warning',
            title: 'Distribution Problem',
            detail: [
                '<ul class="list"><li>',
                    detailMsg.join('</li><li>'),
                '</li></ul>'
            ].join('')
        };
    }

    F.Thread = Backbone.Model.extend({
        database: F.Database,
        storeName: 'threads',
        requiredAttrs: new F.util.ESet(['id', 'type', 'distribution']),
        validTypes: new Set(['conversation', 'announcement']),

        defaults: function() {
            return {
                unreadCount: 0,
                timestamp: Date.now(),
                started: Date.now(),
                position: 0
            };
        },

        initialize: function(attrs) {
            this.messages = new F.MessageCollection([], {
                thread: this
            });
            this.on('read', this.onReadMessage);
            this.on('change:distribution', this.onDistributionChange);
            if (attrs.distribution && !attrs.titleFallback) {
                this.onDistributionChange();
            } else {
                this.repair(); // BG okay..
            }
            this.messageSender = F.foundation.getMessageSender();
        },

        onDistributionChange: function() {
            /* Create a normalized rendition of our distribution title. */
            F.queueAsync(this.id + 'alteration', (async function() {
                await this._repair(/*silent*/ true);
                const distribution = this.get('distribution');
                let dist = await F.atlas.resolveTagsFromCache(distribution);
                const ourTag = F.currentUser.get('tag').id;
                const pending = this.get('pendingMembers') || [];
                const sms = pending.map(x => `<i title="Pending SMS Invitee">SMS:` +
                                        `${x.phone.replace(/^\+/, '')}</i>`).join(' ');
                let title;
                if (dist.includedTagids.indexOf(ourTag) !== -1) {
                    // Remove direct reference to our tag.
                    dist = await F.atlas.resolveTagsFromCache(`(${distribution}) - <${ourTag}>`);
                    if (!dist.universal) {
                        if (!sms) {
                            // No one besides ourself.
                            title = `<span title="@${F.currentUser.getSlug()}">[You]</span>`;
                        } else {
                            title = sms;
                        }
                    }
                }
                if (!title && dist.userids.length === 1 && dist.includedTagids.length === 1 && !sms) {
                    // A 1:1 convo with a user's tag.  Use their formal name.
                    let user = (await F.atlas.getContacts(dist.userids))[0];
                    if (!user) {
                        user = F.util.makeInvalidUser('userId: ' + dist.userids[0]);
                    }
                    if (user.get('tag').id === dist.includedTagids[0]) {
                        let slug;
                        let meta = '';
                        if (user.get('org').id === F.currentUser.get('org').id) {
                            slug = user.getSlug();
                        } else {
                            slug = await user.getFQSlug();
                            meta = `<small> (${(await user.getOrg()).get('name')})</small>`;
                        }
                        title = `<span title="@${slug}">${user.getName()}${meta}</span>`;
                    }
                }
                if (!title) {
                    title = dist.pretty + (sms && ' ' + sms);
                }
                await this.save({
                    titleFallback: title,
                    distributionPretty: dist.pretty
                });
            }).bind(this));
        },

        repair: async function() {
            /* Ensure the distribution for this thread is healthy and repair if needed. */
            await F.queueAsync(this.id + 'alteration', this._repair.bind(this));
        },

        _repair: async function(silent) {
            const curDist = this.get('distribution');
            const expr = await F.atlas.resolveTagsFromCache(this.get('distribution'));
            const notice = tagExpressionWarningsToNotice(expr.warnings);
            if (notice) {
                this.addNotice(notice.title, notice.detail, notice.className);
            }
            if (expr.universal !== curDist) {
                if (expr.pretty !== curDist) {
                    const ourTag = await F.currentUser.get('tag').id;
                    const newDist = await F.atlas.resolveTagsFromCache(`(${curDist}) - <${ourTag}>`);
                    let distMsg;
                    if (!newDist.universal) {
                        distMsg = "[You]";
                    } else {
                        distMsg = newDist.pretty;
                    }
                    const msg = `Changing from "${this.get('distributionPretty')}" to updated distribution "${distMsg}"`;
                    this.addNotice('Repaired distribution', msg, 'success');
                }
                if (silent) {
                    await this.set({distribution: expr.universal}, {silent: true});
                } else {
                    await this.save({distribution: expr.universal});
                }
            }
        },

        addMessage: function(message) {
            console.assert(message instanceof F.Message);
            const ret = this.messages.add(message);
            if (!message.get('read')) {
                this.notify(message);
            }
            return ret;
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
                userAgent: F.userAgent,
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
                console.warn("'safe_html' message provided without 'plain' fallback");
            }
            if (props.plain || props.safe_html) {
                const body = [{
                    type: 'text/plain',
                    value: props.plain || ''
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
            let sender;
            let senderDevice;
            let members;
            let monitors;
            let from;
            if (attrs.type === 'clientOnly') {
                members = [F.currentUser.id];
                monitors = [];
                from = 'Forsta';
            } else {
                members = await this.getMembers();
                monitors = await this.getMonitors();
                sender = F.currentUser.id;
                senderDevice = F.currentDevice;
                from = 'You';
            }
            const now = Date.now();
            const full_attrs = Object.assign({
                id: F.util.uuid4(), // XXX Make this a uuid5 hash.
                sender,
                senderDevice,
                members,
                monitors,
                userAgent: F.userAgent,
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
                lastMessage: `${from}: ${msg.getNotificationText()}`
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
                try {
                    await msg.watchSend(await this.messageSender.send({
                        addrs: msg.get('members'),
                        threadId: exchange[0].threadId,
                        body: exchange,
                        attachments,
                        timestamp: msg.get('sent'),
                        expiration: msg.get('expiration')
                    }));
                } finally {
                    this._sendMessageToMonitors(msg, exchange);
                }
            }.bind(this));
        },

        _sendMessageToMonitors: async function(msg, exchange) {
            /* Send messages to all involved monitor addresses (e.g vaults) */
            const addrs = msg.get('monitors');
            if (addrs.length) {
                try {
                    await this.messageSender.send({
                        addrs,
                        threadId: exchange[0].threadId,
                        body: exchange,
                        attachments: msg.get('attachments'),
                        timestamp: Date.now(),  // Force divergence from original.
                        expiration: msg.get('expiration')
                    });
                } catch(e) {
                    console.warn("Ignoring monitor send error:", e);
                }
            }
        },

        applyUpdates: async function(updates) {
            if ('threadTitle' in updates) {
                const title = updates.threadTitle || undefined; // Use a single falsy type.
                if (title !== this.get('title')) {
                    if (!title) {
                        this.addNotice("Title Cleared");
                    } else {
                        this.addNotice("Title Updated", updates.threadTitle);
                    }
                    this.set('title', title);
                }
            }
            if (updates.distribution && 'expression' in updates.distribution &&
                updates.distribution.expression != this.get('distribution')) {
                const updatedDist = updates.distribution.expression;
                const normalized = await F.atlas.resolveTagsFromCache(updatedDist);
                if (normalized.universal !== updates.distribution.expression) {
                    F.util.reportError('Non-universal expression sent by peer',
                                       {distribution: updatedDist});
                }
                const diff = await F.atlas.diffTags(this.get('distribution'), updatedDist);
                console.info("Distribution diff:", diff);
                if (diff.added.size) {
                    const addedTags = Array.from(diff.added).map(x => `<${x}>`).join();
                    const addedExpr = await F.atlas.resolveTagsFromCache(addedTags);
                    this.addNotice(`<span style="color:green">Added: ${addedExpr.pretty}</span>`);
                }
                if (diff.removed.size) {
                    const removedTags = Array.from(diff.removed).map(x => `<${x}>`).join();
                    const removedExpr = await F.atlas.resolveTagsFromCache(removedTags);
                    this.addNotice(`<span style="color:red">Removed: ${removedExpr.pretty}</span>`);
                }
                this.set('distribution', updatedDist);
            }
            const directMappings = {
                /* proto-key: our-key */
                pinned: 'pinned',
                position: 'position',
                left: 'left'
            };
            for (const key in directMappings) {
                if (key in updates) {
                    this.set(directMappings[key], updates[key]);
                }
            }
        },

        _sendControl: async function(addrs, data) {
            const timestamp = Date.now();
            return await this.messageSender.send({
                addrs,
                threadId: this.id,
                timestamp,
                expiration: this.get('expiration'),
                body: [{
                    version: 1,
                    threadId: this.id,
                    messageType: 'control',
                    messageId: F.util.uuid4(),
                    userAgent: F.userAgent,
                    sendTime: (new Date(timestamp)).toISOString(),
                    sender: {
                        userId: F.currentUser.id
                    },
                    distribution: {
                        expression: this.get('distribution')
                    },
                    data
                }]
            });
        },

        sendControl: async function(data) {
            return await F.queueAsync(this, async function() {
                return await this._sendControl(await this.getMembers(), data);
            }.bind(this));
        },

        sendSyncControl: async function(data) {
            return await F.queueAsync(this, async function() {
                return await this._sendControl([F.currentUser.id], data);
            }.bind(this));
        },

        sendUpdate: async function(threadUpdates, sync) {
            const fn = sync ? this.sendSyncControl : this.sendControl;
            return await fn.call(this, {
                control: 'threadUpdate',
                threadUpdates
            });
        },

        sendClose: async function() {
            return await this.sendSyncControl({control: 'threadClose'});
        },

        sendExpirationUpdate: async function(expiration) {
            await this.save({expiration});
            const flags = relay.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE;
            return F.queueAsync(this, async function() {
                const msg = await this.createMessage({
                    plain: '', // Just to be safe..
                    flags,
                    expiration,
                    expirationUpdate: {
                        expiration,
                        sender: F.currentUser.id
                    }
                });
                const exchange = this.createMessageExchange(msg);
                const outMsg = await this.messageSender.send({
                    addrs: msg.get('members'),
                    threadId: exchange[0].threadId,
                    body: exchange,
                    timestamp: msg.get('sent'),
                    expiration,
                    flags
                });
                await msg.watchSend(outMsg);
            }.bind(this));
        },

        isSearchable: function() {
            return !this.get('left') || !!this.get('lastMessage');
        },

        leaveThread: async function() {
            const dist = this.get('distribution');
            const updated = await relay.hub.resolveTags(`(${dist}) - @${F.currentUser.getSlug()}`);
            if (!updated.universal) {
                throw new Error("Invalid expression");
            }
            await this.save({
                left: true,
                distribution: updated.universal
            });
            await this.sendUpdate({
                distribution: {
                    expression: updated.universal
                }
            });
        },

        archive: async function() {
            await this.sendClose();
            await this.destroy();
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
                    sender: m.get('sender'),
                    timestamp: m.get('sent')
                }));
                if (reads.length) {
                    await this.messageSender.syncReadMessages(reads);
                }
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
                const userId = Array.from(members)[0];
                const them = (await F.atlas.getContacts([userId]))[0];
                if (!them) {
                    return F.util.makeInvalidUser('userId:' + userId).getAvatar();
                } else {
                    return await them.getAvatar();
                }
            } else {
                const sample = await F.atlas.getContacts(Array.from(members).slice(0, 4));
                return {
                    color: this.getColor(),
                    group: await Promise.all(sample.map(u => u.getAvatar())),
                    groupSize: members.size + 1
                };
            }
        },

        getDistribution: async function() {
            const dist = this.get('distribution');
            if (dist) {
                return await F.atlas.resolveTagsFromCache(dist);
            }
        },

        getMonitors: async function() {
            const dist = await this.getDistribution();
            if (!dist) {
                return [];
            }
            return dist.monitorids;
        },

        getMembers: async function() {
            const dist = await this.getDistribution();
            if (!dist) {
                return [];
            }
            return dist.userids;
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
                    this.save();  // BG okay
                }
            } else {
                return mute;
            }
        },

        getNormalizedTitle: function() {
            let title = this.get('title') ||
                        this.get('titleFallback') ||
                        this.get('distributionPretty');
            if (title) {
                return title;
            }
            const t = this.get('type');
            return t[0].toUpperCase() + t.substr(1);
        },

        addNotice: function(title, detail, className) {
            // Make a copy of the array to trigger an update in Backbone.Model.set().
            const notices = Array.from(this.get('notices') || []);
            const id = F.util.uuid4();
            className = className || '';
            detail = detail || '';
            notices.push({
                id,
                title,
                detail,
                className
            });
            this.set('notices', notices);
            return id;
        },

        removeNotice: function(id) {
            const cur = this.get('notices');
            if (cur && cur.length) {
                const scrubbed = cur.filter(x => x.id !== id);
                if (scrubbed.length !== cur.length) {
                    this.set('notices', scrubbed);
                    return true;
                }
            }
        }
    });

    F.ThreadCollection = Backbone.Collection.extend({
        database: F.Database,
        storeName: 'threads',
        model: F.Thread,

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
            let dist = await F.atlas.resolveTagsFromCache(expression);
            if (!dist.universal) {
                throw new ReferenceError("Invalid or empty expression: " + expression);
            }
            if (dist.userids.indexOf(F.currentUser.id) === -1) {
                // Add ourselves to the thread implicitly since the expression
                // didn't have a tag that included us.
                const ourTag = F.currentUser.getSlug();
                return await F.atlas.resolveTagsFromCache(`(${expression}) + @${ourTag}`);
            } else {
                return dist;
            }
        },

        findByDistribution(distribution, type) {
            const filter = {distribution};
            if (type) {
                filter.type = type;
            }
            return this.where(filter);
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
            const thread = this.add(attrs);
            const notice = tagExpressionWarningsToNotice(dist.warnings);
            if (notice) {
                thread.addNotice(notice.title, notice.detail, notice.className);
            }
            await thread.save();
            return thread;
        },

        ensure: async function(expression, attrs) {
            attrs = attrs || {};
            const dist = await this.normalizeDistribution(expression);
            const threads = this.findByDistribution(dist.universal, attrs.type);
            if (threads.length) {
                const thread = threads[0];
                const notice = tagExpressionWarningsToNotice(dist.warnings);
                if (notice) {
                    thread.addNotice(notice.title, notice.detail, notice.className);
                }
                // Bump the timestamp given the interest level change.
                await thread.save({timestamp: Date.now()});
                return thread;
            } else {
                return await this.make(expression, attrs);
            }
        }
    });

    const ProxyCollection = Backbone.Collection.extend({

        constructor: function(parent) {
            this._parent = parent;
            Backbone.Collection.prototype.constructor.call(this);
            this.listenTo(parent, 'add', this.onParentAdd);
            this.listenTo(parent, 'remove', this.onParentRemove);
            this.listenTo(parent, 'reset', this.onParentReset);
            this.onParentReset(parent.models);
        },

        isOurs: function(model) {
            /* Subclasses should implement a filter here to determine if a model should be
             * included in this collection. */
            return true;
        },

        onParentAdd: function(model) {
            if (this.isOurs(model) && !this.get(model.id)) {
                this.add([model]);
            }
        },

        onParentRemove: function(model) {
            const ourModel = this.get(model.id);
            if (ourModel) {
                this.remove([ourModel]);
            }
        },

        onParentReset: function(models) {
            this.reset(models.filter(this.isOurs.bind(this)));
        },

        onReposition: function(model) {
            // Only supports one item moving per call.
            const older = Array.from(this.models);
            const oldIndex = this.models.indexOf(model);
            this.sort();
            const newIndex = this.models.indexOf(model);
            older.splice(oldIndex, 1);
            older.splice(newIndex, 0, model);
            console.assert(_.isEqual(this.models, older), "More than one model was sorted");
            if (oldIndex !== newIndex) {
                this.trigger('reposition', model, newIndex);
            }
        }
    });

    F.PinnedThreadCollection = ProxyCollection.extend({

        initialize: function() {
            this.on("change:position", this.onReposition);
        },

        isOurs: function(model) {
            return !!model.get('pinned');
        },

        comparator: function(m1, m2) {
            const p1 = m1.get('position');
            const p2 = m2.get('position');
            return (p1 || 0) - (p2 || 0);
        }
    });

    F.RecentThreadCollection = ProxyCollection.extend({

        initialize: function() {
            this.on("change:timestamp", this.onReposition);
        },

        isOurs: function(model) {
            return !model.get('pinned');
        },

        comparator: function(m1, m2) {
            const ts1 = m1.get('timestamp');
            const ts2 = m2.get('timestamp');
            return (ts2 || 0) - (ts1 || 0);
        }
    });
})();
