// vim: ts=4:sw=4:expandtab
/* global relay Backbone runes_substr */

(function () {
    'use strict';

    self.F = self.F || {};

    function tagExpressionWarningsToNotice(warnings) {
        /* Convert distribution warning objects to thread notices. */
        if (!warnings.length) {
            return;
        }
        const detailMsg = [];
        let usersRemoved = 0;
        for (const warning of warnings) {
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
            title: 'Distribution Problem',
            className: 'warning',
            detail: [
                '<ul class="list"><li>',
                    detailMsg.join('</li><li>'),
                '</li></ul>'
            ].join(''),
            icon: 'fire extinguisher'
        };
    }

    F.Thread = Backbone.Model.extend({
        database: F.Database,
        storeName: 'threads',
        requiredAttrs: new F.util.ESet(['type', 'distribution']),
        validTypes: new Set(['conversation', 'announcement']),

        defaults: function() {
            return {
                id: F.util.uuid4(),
                unreadCount: 0,
                timestamp: Date.now(),
                started: Date.now(),
                position: 0,
                archived: 0
            };
        },

        toString: function() {
            return `<Thread id:${this.id} "${this.getNormalizedTitle(/*text*/ true)}">`;
        },

        initialize: function(attrs, options) {
            options = options || {};
            this.messageSender = F.foundation.getMessageSender();
            this.alterationLock = `thread-alteration-lock-${this.id}`;
            this.sendLock = `thread-send-lock-${this.id}`;
            this.unreadLock = `thread-unread-lock-${this.id}`;
            // Debounced unread count updater.  Make sure it's less time than the nav's
            // debounced time otherwise the nav will experience false positives as it 
            // catches up.
            this.scheduleUnreadUpdate = _.debounce(this._unreadUpdateCallback, 400);
            if (!options.deferSetup) {
                this.setup();
            }
        },

        setup: function() {
            this.messages = new F.MessageCollection([], {
                thread: this
            });
            this.on('change:distribution', this.onDistributionChange);
            if (this.get('distribution') && !this.get('titleFallback')) {
                this.onDistributionChange();
            } else {
                this.repair(); // BG okay..
            }
        },

        onDistributionChange: function() {
            /* Create a normalized rendition of our distribution title. */
            F.queueAsync(this.alterationLock, async () => {
                await this._repair({silent: true});
                const distribution = this.get('distribution');
                let dist = await F.atlas.resolveTagsFromCache(distribution);
                const left = dist.userids.indexOf(F.currentUser.id) === -1;
                const ourTagId = F.currentUser.get('tag').id;
                const pendingMembers = this.get('pendingMembers') || [];
                let title;
                if (dist.includedTagids.indexOf(ourTagId) !== -1) {
                    // Remove direct reference to our tag.
                    dist = await F.atlas.resolveTagsFromCache(`(${distribution}) - <${ourTagId}>`);
                    if (!dist.universal && !pendingMembers.length) {
                        // No one besides ourself.
                        title = `<span title="${F.currentUser.getTagSlug()}">[You]</span>`;
                    }
                }
                if (!title) {
                    // Detect if 1:1 convo with a user's tag and use their formal name.
                    let solo;
                    if (dist.userids.length === 1 && dist.includedTagids.length === 1 &&
                        !pendingMembers.length) {
                        solo = await F.atlas.getContact(dist.userids[0]);
                        if (solo && solo.get('tag').id !== dist.includedTagids[0]) {
                            solo = undefined;
                        }
                    } else if (dist.userids.length === 0 && dist.includedTagids.length === 0 &&
                               pendingMembers.length === 1) {
                        solo = await F.atlas.getContact(pendingMembers[0]);
                    }
                    if (solo) {
                        const slug = solo.getTagSlug();
                        let meta = '';
                        const orgId = solo.get('org').id;
                        if (orgId && orgId !== F.currentUser.get('org').id) {
                            meta = `<small> (${(await solo.getOrg()).get('name')})</small>`;
                        }
                        title = `<span title="${slug}">${solo.getName()}${meta}</span>`;
                    }
                }
                if (!title) {
                    title = dist.pretty;
                    if (pendingMembers.length) {
                        const pendingContacts = (await F.atlas.getContacts(pendingMembers)).filter(x => x);
                        if (pendingContacts.length) {
                            const pendingExpr = pendingContacts.map(x => x.getTagSlug()).join(' + ');
                            title += ` + ${pendingExpr}`;
                        }
                    }
                }
                await this.save({
                    titleFallback: title,
                    distributionPretty: dist.pretty,
                    left
                });
            });
        },

        repair: async function() {
            /* Ensure the distribution for this thread is healthy and repair if needed. */
            await F.queueAsync(this.alterationLock, () => this._repair);
        },

        _repair: async function(options) {
            options = options || {};
            const curDist = this.get('distribution');
            const ourTag = `<${await F.currentUser.get('tag').id}>`;
            let expr;
            if (curDist) {
                try {
                    expr = await F.atlas.resolveTagsFromCache(curDist);
                } catch(e) {
                    console.error("Invalid thread distribution " + this, curDist, e);
                }
            } else {
                console.error("Thread with no distribution detected: " + this);
            }
            if (!expr || !expr.universal) {
                expr = await F.atlas.resolveTagsFromCache(ourTag);
            }
            const notice = tagExpressionWarningsToNotice(expr.warnings);
            if (notice) {
                this.addNotice(notice);
            }
            if (expr.universal !== curDist) {
                if (expr.pretty !== curDist) {  // Skip notice for pretty -> universal repair.
                    this.addNotice({
                        title: 'Repaired distribution',
                        detail: `Changing from "${this.get('distributionPretty')}" to "${expr.pretty}"`,
                        className: 'warning',
                        icon: 'wrench'
                    });
                }
                if (options.silent) {
                    await this.set({distribution: expr.universal}, {silent: true});
                } else {
                    await this.save({distribution: expr.universal});
                }
            }
        },

        addMessage: async function(message) {
            console.assert(message instanceof F.Message);
            const isReply = !!message.get('messageRef');
            const isVote = isReply && typeof message.get('vote') === 'number';
            if (!isVote) {
                let from;
                let unread;
                if (!message.get('sender') && message.get('type') === 'clientOnly') {
                    from = 'Forsta';
                } else if (message.get('sender') === F.currentUser.id) {
                    from = 'You';
                } else {
                    from = (await message.getSender()).getInitials();
                    if (!message.get('read')) {
                        unread = true;
                    }
                }
                if (unread) {
                    this.notify(message);
                }
                await F.queueAsync(this.unreadLock, async () => {
                    await this.save({
                        timestamp: Math.max(this.get('timestamp') || 0, message.get('sent')),
                        lastMessage: `${from}: ${message.getNotificationText()}`,
                        unreadCount: this.get('unreadCount') + (unread ? 1 : 0)
                    });
                });
            }
            if (isReply) {
                const refMsg = await this.getMessage(message.get('messageRef'));
                if (!refMsg) {
                    console.warn('Reply to invalid message');
                    return;
                }
                if (isVote) {
                    await refMsg.addVote(message.get('vote'));
                } else {
                    await refMsg.addReply(message);
                }
            } else {
                this.messages.add(message);
            }
        },

        _unreadUpdateCallback: async function() {
            await F.queueAsync(this.unreadLock, async () => {
                const unread = await this.fetchUnread();
                await this.save({unreadCount: unread.length});
            });
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
                messageRef: message.get('messageRef'),
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

        createMessageExchange: function(message, data) {
            /* Create Forsta msg exchange v1: https://goo.gl/N9ajEX */
            const props = message.attributes;
            data = Object.assign({}, data);
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
            data.mentions = message.get('mentions');
            data.vote = message.get('vote');
            return this._createExchange(message, data);
        },

        createControlExchange: function(message, controlData) {
            return this._createExchange(message, controlData, null, 'control');
        },

        createMessage: async function(attrs, options) {
            /* Create and save a well-formed outgoing message for this thread. */
            options = options || {};
            let sender;
            let senderDevice;
            let members;
            let monitors;
            if (attrs.type === 'clientOnly') {
                members = [F.currentUser.id];
                monitors = [];
            } else {
                members = await this.getMembers();
                monitors = await this.getMonitors();
                sender = F.currentUser.id;
                senderDevice = F.currentDevice;
            }
            const pendingMembers = this.get('pendingMembers');
            const message = new F.Message(Object.assign({
                id: F.util.uuid4(),
                sender,
                senderDevice,
                members,
                pendingMembers: pendingMembers && Array.from(pendingMembers),
                monitors,
                userAgent: F.userAgent,
                threadId: this.id,
                type: 'content',
                expiration: this.get('expiration')
            }, attrs));
            if (!options.ephemeral) {
                await message.save();
                await this.addMessage(message);
            }
            return message;
        },

        sendMessage: async function(plain, safe_html, attachments, attrs, options) {
            attrs = attrs || {};
            options = options || {};
            attachments = attachments || [];
            await F.queueAsync(this.sendLock, async () => {
                const msg = await this.createMessage({
                    plain,
                    safe_html,
                    attachments,
                    messageRef: attrs.messageRef,
                    mentions: attrs.mentions,
                    vote: attrs.vote,
                }, {ephemeral: options.ephemeral});
                const exchange = this.createMessageExchange(msg, attrs.data);
                let addrs;
                const pendingMembers = msg.get('pendingMembers');
                if (pendingMembers && pendingMembers.length) {
                    const members = new F.util.ESet(msg.get('members'));
                    addrs = Array.from(members.difference(new F.util.ESet(pendingMembers)));
                } else {
                    addrs = msg.get('members');
                }
                let outMsg;
                try {
                    outMsg = await this.messageSender.send({
                        addrs,
                        threadId: exchange[0].threadId,
                        body: exchange,
                        attachments,
                        timestamp: msg.get('sent'),
                        expiration: msg.get('expiration')
                    });
                } finally {
                    this._sendMessageToMonitors(msg, exchange);
                }
                if (!options.ephemeral) {
                    await msg.watchSend(outMsg);
                }
                F.util.reportUsageEvent('Message', 'send');
            });
        },

        sendPreMessage: async function(contact, msg) {
            /* Send pre-message that was queued waiting for the user to register. */
            await F.queueAsync(this.sendLock, async () => {
                const exchange = this.createMessageExchange(msg);
                await msg.watchSend(await this.messageSender.send({
                    addrs: [contact.id],
                    threadId: exchange[0].threadId,
                    body: exchange,
                    attachments: msg.get('attachments'),
                    timestamp: msg.get('sent'),
                    expiration: msg.get('expiration')
                }));
            });
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

        applyUpdates: async function(updates, options) {
            options = options || {};
            if ('threadTitle' in updates) {
                const title = updates.threadTitle || undefined; // Use a single falsy type.
                if (title !== this.get('title')) {
                    if (!title) {
                        this.addNotice({title: "Title Cleared"});
                    } else {
                        this.addNotice({
                            title: "Title Updated",
                            detail: updates.threadTitle,
                            icon: 'pencil'
                        });
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
                    this.addNotice({
                        title: 'Distribution Changed',
                        detail: `Added: ${addedExpr.pretty}`,
                        className: 'success',
                        icon: 'user add'
                    });
                }
                if (diff.removed.size) {
                    const removedTags = Array.from(diff.removed).map(x => `<${x}>`).join();
                    const removedExpr = await F.atlas.resolveTagsFromCache(removedTags);
                    this.addNotice({
                        title: 'Distribution Changed',
                        detail: `Removed: ${removedExpr.pretty}`,
                        className: 'warning',
                        icon: 'user remove'
                    });
                }
                this.set('distribution', updatedDist);
            }
            if (options.includePrivate) {
                const directMappings = {
                    /* proto-key: our-key */
                    pinned: 'pinned',
                    position: 'position',
                    left: 'left',
                    blocked: 'blocked',
                };
                for (const key in directMappings) {
                    if (key in updates) {
                        this.set(directMappings[key], updates[key]);
                    }
                }
            }
        },

        _sendControl: async function(addrs, data, attachments) {
            const timestamp = Date.now();
            return await this.messageSender.send({
                addrs,
                threadId: this.id,
                timestamp,
                expiration: this.get('expiration'),
                attachments,
                body: [{
                    version: 1,
                    threadId: this.id,
                    threadType: this.get('type'),
                    threadTitle: this.get('title'),
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

        sendControl: async function(data, attachments, options) {
            options = options || {};
            return await F.queueAsync(this.sendLock, async () => {
                let addrs = options.addrs;
                if (!addrs) {
                    addrs = new Set(await this.getMembers(/*excludePending*/ true));
                    if (options.excludeSelf) {
                        addrs.delete(F.currentUser.id);
                    } else {
                        addrs.add(F.currentUser.id);
                    }
                }
                return await this._sendControl(Array.from(addrs), data, attachments);
            });
        },

        sendSyncControl: async function(data, attachments) {
            return await F.queueAsync(this.sendLock, () =>
                this._sendControl([F.currentUser.id], data, attachments));
        },

        sendUpdate: async function(threadUpdates, options) {
            options = options || {};
            const fn = options.sync ? this.sendSyncControl : this.sendControl;
            return await fn.call(this, {
                control: 'threadUpdate',
                threadUpdates
            });
        },

        sendExpirationUpdate: async function(expiration) {
            await this.save({expiration});
            const flags = relay.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE;
            await F.queueAsync(this.sendLock, async () => {
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
                await msg.watchSend(await this.messageSender.send({
                    addrs: msg.get('members'),
                    threadId: exchange[0].threadId,
                    body: exchange,
                    timestamp: msg.get('sent'),
                    expiration,
                    flags
                }));
            });
        },

        isSearchable: function() {
            return !this.get('left') || !!this.get('lastMessage');
        },

        leaveThread: async function() {
            const dist = this.get('distribution');
            const updated = await F.atlas.resolveTagsFromCache(`(${dist}) - ${F.currentUser.getTagSlug()}`);
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

        archive: async function(options) {
            options = options || {};
            await this.save('archived', 1);
            F.foundation.allThreads.remove(this);
            if (!options.silent) {
                await this.sendSyncControl({control: 'threadArchive'});
            }
        },

        restore: async function(options) {
            options = options || {};
            await this.save('archived', 0);
            F.foundation.allThreads.add(this, {merge: true});
            if (!options.silent) {
                await this.sendSyncControl({control: 'threadRestore'});
            }
        },

        expunge: async function(options) {
            options = options || {};
            await this.destroyMessages();
            await this.destroy();
            if (!options.silent) {
                await this.sendSyncControl({control: 'threadExpunge'});
            }
        },

        clearUnread: async function() {
            await F.queueAsync(this.unreadLock, async () => {
                await this.save({unreadCount: 0});
                if (F.notifcations) {
                    F.notifications.remove(F.notifications.where({threadId: this.id}));
                }
                /* Note, do not combine the markRead calls.  They must be seperate to avoid
                 * dubious read values. */
                const unread = this.messages.where({read: 0});
                await Promise.all(unread.map(m => m.markRead(null, {threadSilent: true})));
                /* Handle unpaged models too (but only after in-mem ones!)... */
                const dbUnread = (await this.fetchUnread()).models;
                await Promise.all(dbUnread.map(m => m.markRead(null, {threadSilent: true})));
            });
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

        getColor: function(hex) {
            const color = this.get('color');
            /* Only accept custom colors that match our palette. */
            if (!color || F.util.themeColors.indexOf(color) === -1) {
                return F.util.pickColor(this.id, hex);
            }
            return hex ? F.util.themeColors[color] : color;
        },

        getAvatar: async function(options) {
            options = options || {};
            const members = new Set(await this.getMembers());
            members.delete(F.currentUser.id);
            if (members.size === 0) {
                return await F.currentUser.getAvatar(options);
            } else if (members.size === 1) {
                const userId = Array.from(members)[0];
                const them = await F.atlas.getContact(userId);
                if (!them) {
                    return await F.util.makeInvalidUser('userId:' + userId).getAvatar(options);
                } else {
                    return await them.getAvatar(options);
                }
            } else {
                const sample = (await F.atlas.getContacts(Array.from(members).slice(0, 10))).filter(x => x);
                if (options.size) {
                    console.warn("Overriding avatar size for group");
                }
                const groupOptions = Object.assign({}, options);
                groupOptions.size = 'small';
                return {
                    color: this.getColor(/*hex*/ true),
                    abbrTitle: this.getAbbrTitle(),
                    group: await Promise.all(sample.map(u => u.getAvatar(groupOptions))),
                    groupSize: members.size,
                    sampleSize: sample.length
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

        getMembers: async function(excludePending) {
            const dist = await this.getDistribution();
            const ids = dist ? dist.userids : [];
            return excludePending ? ids : ids.concat(this.get('pendingMembers') || []);
        },

        getMemberCount: async function() {
            return (await this.getMembers()).length;
        },

        getContacts: async function(excludePending) {
            const contacts = await F.atlas.getContacts(await this.getMembers(excludePending));
            return contacts.filter(x => x);
        },

        notify: function(message) {
            if (!F.notifications ||
                !message.get('incoming') ||
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

        getNormalizedTitle: function(text) {
            let title;
            if (text && !self.$) {
                // In a service worker; no jquery/dom so skip the html attr `titleFallback`.
                title = this.get('title') || this.get('distributionPretty');
            } else {
                title = this.get('title') ||
                        this.get('titleFallback') ||
                        this.get('distributionPretty');
            }
            if (!title) {
                const t = this.get('type');
                title = t[0].toUpperCase() + t.substr(1);
            }
            return (text && self.$) ? $(`<span>${title}</span>`).text() : title;
        },

        getAbbrTitle: function(text) {
            const title = this.get('title') || this.get('titleFallback');
            if (!title) {
                return;
            }
            const words = title.split(/[\s+-]+/).map(x => x.replace(/^@/, ''));
            if (words.length === 1) {
                if (words[0].length <= 3) {
                    return words[0];
                } else {
                    return runes_substr(words[0], 0, 1).toUpperCase();
                }
            } else if (words.length <= 3) {
                return words.map(x => runes_substr(x, 0, 1).toUpperCase()).join('');
            } else {
                return;
            }
        },

        addNotice: function(options) {
            // Make a copy of the array to trigger an update in Backbone.Model.set().
            console.assert(options.title);
            const notices = Array.from(this.get('notices') || []);
            const id = F.util.uuid4();
            notices.push({
                id,
                title: options.title,
                detail: options.detail,
                className: options.className,
                icon: options.icon,
                created: Date.now()
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
        },

        getMessage: async function(id) {
            let msg = this.messages.get(id);
            if (!msg) {
                msg = new F.Message({id});
                try {
                    await msg.fetch();
                } catch(e) {
                    if (e instanceof ReferenceError) {
                        console.warn("Message not found:", id);
                        return;
                    } else {
                        throw e;
                    }
                }
                // Handle replies to replies.  Typically used in voting.  Ideally we return
                // the model in a local collection because it will be bound to a view.
                if (msg.get('messageRef')) {
                    const parent = await this.getMessage(msg.get('messageRef'));
                    const boundMsg = parent && parent.replies.get(id);
                    if (boundMsg) {
                        return boundMsg;
                    }
                }
            }
            return msg;
        },
    });

    F.ThreadCollection = Backbone.Collection.extend({
        database: F.Database,
        storeName: 'threads',
        model: F.Thread,

        fetchOrdered: async function(limit) {
            return await this.fetch({
                limit,
                index: {
                    name: 'archived-timestamp',
                    lower : [0],
                    upper : [0, Infinity]
                }
            });
        },

        fetchByPendingMember: async function(memberId) {
            await this.fetch({
                index: {
                    name: 'pendingMember',
                    only: memberId
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
                const ourTag = F.currentUser.getTagSlug();
                return await F.atlas.resolveTagsFromCache(`(${expression}) + ${ourTag}`);
            } else {
                return dist;
            }
        },

        findByDistribution(distribution, type) {
            const filter = {distribution};
            if (type) {
                filter.type = type;
            }
            return this.where(filter).filter(x => !x.get('pendingMembers') ||
                                                  !x.get('pendingMembers').length);
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
                thread.addNotice(notice);
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
                    thread.addNotice(notice);
                }
                await thread.save(Object.assign({timestamp: Date.now()}, attrs));
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
            this.sort();
        }
    });

    F.PinnedThreadCollection = ProxyCollection.extend({

        initialize: function() {
            this.on("change:position", this.onReposition);
        },

        isOurs: function(model) {
            return !!model.get('pinned');
        },

        comparator: function(a, b) {
            const aPos = a.get('position') || 0;
            const bPos = b.get('position') || 0;
            return (aPos - bPos) || (a.id === b.id ? 0 : (a.id < b.id ? -1 : 1));
        }
    });

    F.RecentThreadCollection = ProxyCollection.extend({

        initialize: function() {
            this.on("change:timestamp", this.onReposition);
        },

        isOurs: function(model) {
            return !model.get('pinned');
        },

        comparator: function(a, b) {
            const aTS = a.get('timestamp') || 0;
            const bTS = b.get('timestamp') || 0;
            return (bTS - aTS) || (a.id === b.id ? 0 : (a.id < b.id ? -1 : 1));
        }
    });
})();
