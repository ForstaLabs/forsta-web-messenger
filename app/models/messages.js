// vim: ts=4:sw=4:expandtab
/* global relay Backbone */

(function () {
    'use strict';

    self.F = self.F || {};

    F.Message = F.SearchableModel.extend({
        database: F.Database,
        storeName: 'messages',
        searchIndexes: [{
            length: 3,
            attr: async model => {
                const from = await model.getSender();
                if (from) {
                    return from.getName() + ' ' + from.getTagSlug();
                }
            },
            index: 'from-ngrams',
            column: '_from_ngrams'
        }, {
            length: 3,
            attr: async model => {
                const thread = model.getThread();
                if (thread) {
                    const to = await thread.getContacts();
                    return to.map(x => x.getName() + ' ' + x.getTagSlug(/*full*/ true)).join(' ');
                }
            },
            index: 'to-ngrams',
            column: '_to_ngrams'
        }, {
            default: true,
            length: 3,
            attr: 'plain',
            index: 'body-ngrams',
            column: '_body_ngrams'
        }],

        messageHandlerMap: {
            content: '_handleContentMessage',
            control: '_handleControlMessage',
            receipt: '_handleReceiptMessage',
            poll: '_handlePollMessage',
            pollResponse: '_handlePollResponseMessage'
        },
        controlHandlerMap: {
            discover: '_handleDiscoverControl',
            discoverResponse: '_handleDiscoverResponseControl',
            provisionRequest: '_handleProvisionRequestControl',
            threadUpdate: '_handleThreadUpdateControl',
            threadArchive: '_handleThreadArchiveControl',
            threadClose: '_handleThreadArchiveControl',  // XXX DEPRECATED
            preMessageCheck: '_handlePreMessageCheck',
        },

        initialize: function() {
            this.receipts = new F.MessageReceiptCollection([], {message: this});
            this.receiptsLoaded = this.receipts.fetchAll();
            this.on('change:attachments', this.updateAttachmentPreview);
            this.on('change:expirationStart', this.setToExpire);
            this.on('change:expiration', this.setToExpire);
            this.setToExpire();
        },

        defaults: function() {
            return {
                sent: Date.now(),
                attachments: []
            };
        },

        set: function(key, val, options) {
            if (key == null) {
                return this;
            }
            // Handle both `"key", value` and `{key: value}` -style arguments.
            let attrs;
            if (typeof key === 'object') {
                attrs = key;
                options = val;
            } else {
                attrs = {};
                attrs[key] = val;
            }
            if (!options) {
                options = {};
            }
            if (self.document && attrs.html) {
                if (attrs.html !== this.attributes.safe_html) {
                    /* Augment the model with a safe version of html so we don't have to
                     * rerender every message on every thread view. */
                    attrs.safe_html = F.emoji.replace_unified(F.util.htmlSanitize(attrs.html));
                }
                delete attrs.html;
            }
            return Backbone.Model.prototype.set.call(this, attrs, options);
        },

        validate: function(attrs, options) {
            const required = [
                'threadId',
                'received',
                'sent'
            ];
            const missing = _.filter(required, x => attrs[x] === undefined);
            if (missing.length) {
                return new Error("Message missing attributes: " + missing);
            }
        },

        isEndSession: function() {
            const flag = relay.protobuf.DataMessage.Flags.END_SESSION;
            return !!(this.get('flags') & flag);
        },

        isExpirationUpdate: function() {
            const expire = relay.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE;
            return !!(this.get('flags') & expire);
        },

        isClientOnly: function() {
            return this.get('type') === 'clientOnly';
        },

        isUnread: function() {
            return !this.get('read');
        },

        getMeta: function() {
            const meta = [];
            const notes = this.get('notes');
            if (notes && notes.length) {
                meta.push.apply(meta, notes);
            }
            if (this.isEndSession()) {
                meta.push('Secure session reset');
            }
            if (this.isExpirationUpdate()) {
                const t = this.get('expirationUpdate').expiration;
                if (t) {
                    const human_time = F.tpl.help.humantime(t * 1000);
                    meta.push(`Message expiration set to ${human_time}`);
                } else {
                    meta.push('Message expiration turned off');
                }
            }
            if (this.get('type') === 'keychange') {
                meta.push('Identity key changed');
            }
            const att = this.get('attachments');
            if (att.length === 1) {
                meta.push(`${att.length} Attachment`);
            } else if (att.length > 1) {
                meta.push(`${att.length} Attachments`);
            }
            if (this.get('incoming') && this.hasErrors() && !meta.length) {
                meta.push('Error handling incoming message');
            }
            if (this.isClientOnly()) {
                meta.push('Only visible to you');
            }
            return meta;
        },

        getNotificationText: function() {
            const text = this.get('plain');
            if (text) {
                return text;
            }
            const meta = this.getMeta();
            return meta.length ? `(${meta.join(', ')})` : '';
        },

        updateAttachmentPreview: async function() {
            const attachment = this.get('attachments')[0];
            if (attachment) {
                const blob = new Blob([attachment.data], {
                    type: attachment.type
                });
                this.attachmentPreview = await F.util.blobToDataURL(blob);
            } else {
                this.attachmentPreview = null;
            }
        },

        getAttachmentPreview: async function() {
            if (this.attachmentPreview === undefined) {
                await this.updateAttachmentPreview();
            }
            return this.attachmentPreview;
        },

        getThread: function(threadId) {
            /* Get a thread model for this message. */
            threadId = threadId || this.get('threadId');
            return F.foundation.allThreads.get(threadId);
        },

        getThreadMessage: function() {
            /* Return this same message but from a thread collection.  Note that
             * it's entirely possible if not likely that this returns self or undefined. */
            const thread = this.getThread();
            return thread && thread.messages.get(this.id);
        },

        getSender: async function() {
            const userId = this.get('sender');
            if (!userId) {
                return;
            }
            const user = (await F.atlas.getContacts([userId]))[0];
            return user || F.util.makeInvalidUser('userId:' + userId);
        },

        hasErrors: function() {
            return !!this.receipts.findWhere({type: 'error'});
        },

        watchSend: async function(outmsg) {
            outmsg.on('sent', this.addSentReceipt.bind(this));
            outmsg.on('error', this.addErrorReceipt.bind(this));
            for (const x of outmsg.sent) {
                this.addSentReceipt(x); // bg async ok
            }
            for (const x of outmsg.errors) {
                this.addErrorReceipt(x); // bg async ok
            }
            if (this.get('expiration')) {
                await this.save({expirationStart: Date.now()});
            }
        },

        _copyError: function(errorDesc) {
            /* Serialize the errors for storage to the DB. */
            console.assert(errorDesc.error instanceof Error);
            return Object.assign({
                timestamp: errorDesc.timestamp,
            }, _.pick(errorDesc.error, 'name', 'message', 'code', 'addr',
                      'reason', 'functionCode', 'args', 'stack'));
        },

        parseExchange(raw) {
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
            bestVersion.getText = type => {
                if (!bestVersion.data || !bestVersion.data.body) {
                    return null;
                }
                for (const x of bestVersion.data.body)
                    if (x.type === `text/${type}`)
                        return x.value;
            };
            return bestVersion;
        },

        parseAttachments(exchange, protoAttachments) {
            /* Combine meta data from our exchange into the protocol level
             * attachment data. */
            const metaAttachments = exchange.data && exchange.data.attachments;
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

        handleDataMessage: function(dataMessage) {
            const exchange = dataMessage.body ? this.parseExchange(dataMessage.body) : {};
            const requiredAttrs = new F.util.ESet([
                'messageId',
                'messageType',
                'sender'
            ]);
            const missing = requiredAttrs.difference(new F.util.ESet(Object.keys(exchange)));
            if (missing.size) {
                if (this.isEndSession()) {
                    console.warn("Silencing blank end-session message:", dataMessage);
                } else {
                    F.util.reportError("Message Exchange Violation", {
                        model: this.attributes,
                        dataMessage,
                        missing: Array.from(missing),
                    });
                }
                return;
            }
            // Maintain processing order by threadId or messageType (e.g. avoid races).
            const queue = 'msg-handler:' + (exchange.threadId || exchange.messageType);
            const messageHandler = this[this.messageHandlerMap[exchange.messageType]];
            F.queueAsync(queue, messageHandler.bind(this, exchange, dataMessage));
        },

        _handleControlMessage: async function(exchange, dataMessage) {
            await this.destroy(); // No need for a message object in control cases.
            const control = exchange.data && exchange.data.control;
            const controlHandler = this[this.controlHandlerMap[control]];
            if (!controlHandler) {
                F.util.reportWarning("Unhandled control: " + control, {
                    exchange,
                    dataMessage
                });
                return;
            }
            await controlHandler.call(this, exchange, dataMessage);
        },

        _updateOrCreateThread: async function(exchange) {
            let thread = this.getThread(exchange.threadId);
            if (!thread) {
                console.info("Creating new thread:", exchange.threadId);
                thread = await F.foundation.allThreads.make(exchange.distribution.expression, {
                    id: exchange.threadId,
                    type: exchange.threadType,
                    title: exchange.threadTitle || undefined,
                });
            }
            await thread.applyUpdates(exchange);
            return thread;
        },

        _getConversationThread: async function(exchange) {
            return await this._updateOrCreateThread(exchange);
        },

        _getAnnouncementThread: async function(exchange) {
            let thread = this.getThread(exchange.threadId);
            if (!thread) {
                if (exchange.messageRef) {
                    console.error('We do not have the announcement thread this message refers to!');
                    return;
                } else {
                    thread = await F.foundation.allThreads.make(exchange.distribution.expression, {
                        id: exchange.threadId,
                        type: exchange.threadType,
                        title: exchange.threadTitle,
                        sender: exchange.sender.userId,
                        sent: true,
                        disableResponses: exchange.disableResponses,
                        privateResponses: exchange.privateResponses
                    });
                }
            }
            return await this._updateOrCreateThread(exchange);
        },

        _ensureThread: async function(exchange) {
            return await {
                conversation: this._getConversationThread,
                announcement: this._getAnnouncementThread
            }[exchange.threadType].call(this, exchange);
        },

        _handleContentMessage: async function(exchange, dataMessage) {
            const thread = await this._ensureThread(exchange);
            this.set({
                id: exchange.messageId,
                type: exchange.messageType,
                sender: exchange.sender.userId,
                messageRef: exchange.messageRef,
                userAgent: exchange.userAgent,
                members: await thread.getMembers(),
                plain: exchange.getText && exchange.getText('plain'),
                html: exchange.getText && exchange.getText('html'),
                threadId: thread.id,
                attachments: this.parseAttachments(exchange, dataMessage.attachments),
                flags: dataMessage.flags,
                mentions: exchange.data && exchange.data.mentions
            });
            /* Sometimes the delivery receipts and read-syncs arrive before we get the message
             * itself.  Drain any pending actions from their queue and associate them now. */
            if (!this.get('incoming')) {
                for (const x of await F.drainDeliveryReceipts(this)) {
                    await this.addDeliveryReceipt(x);
                }
            } else {
                if ((await F.drainReadReceipts(this)).length) {
                    await this.markRead(null, /*save*/ false);
                } else {
                    thread.set('unreadCount', thread.get('unreadCount') + 1);
                }
            }
            if (this.isExpirationUpdate()) {
                this.set('expirationUpdate', {
                    sender: this.get('sender'),
                    expiration: this.get('expiration')
                });
                thread.set('expiration', this.get('expiration'));
            }
            const sender = await this.getSender();
            thread.set('timestamp', Math.max(thread.get('timestamp') || 0, this.get('sent')));
            thread.set('lastMessage', `${sender.getInitials()}: ${this.getNotificationText()}`);
            await Promise.all([this.save(), thread.save()]);
            thread.addMessage(this);
        },

        _handleReceiptMessage: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleAnnouncement: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handlePollMessage: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handlePollResponseMessage: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleDiscoverControl: async function(exchange, dataMessage) {
            const threads = F.foundation.allThreads;
            const matches = threads.findWhere(exchange.distribution.expresssion,
                                              exchange.threadType);
            const msgSender = F.foundation.getMessageSender();
            const now = Date.now();
            await msgSender.send({
                addrs: [exchange.sender.userId],
                timestampe: now,
                threadId: exchange.threadId,
                body: [{
                    version: 1,
                    messageId: F.util.uuid4(),
                    messageType: 'discoverResponse',
                    threadId: exchange.threadId,
                    userAgent: F.userAgent,
                    sendTime: (new Date(now)).toISOString(),
                    sender: {
                        userId: F.currentUser.id
                    },
                    distribution: {
                        expression: exchange.distribution.expresssion
                    },
                    data: {
                        threadDiscoveryCandidates: matches.map(x => ({
                            threadId: x.get('threadId'),
                            threadTitle: x.get('threadTitle'),
                            started: x.get('started'),
                            lastActivity: x.get('timestamp')
                        }))
                    }
                }]
            });
        },

        _handleDiscoverResponseControl: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleProvisionRequestControl: async function(exchange, dataMessage) {
            const requestedBy = exchange.sender.userId;
            if (F.env.SUPERMAN_NUMBER && requestedBy !== F.env.SUPERMAN_NUMBER) {
                F.util.reportError('Provision request received from untrusted address', {
                    requestedBy,
                    exchange,
                    dataMessage
                });
                return;
            }
            console.info('Handling provision request:', exchange.data.uuid);
            const am = await F.foundation.getAccountManager();
            await am.linkDevice(exchange.data.uuid, atob(exchange.data.key));
            console.info('Successfully linked with:', exchange.data.uuid);
        },

        _handleThreadUpdateControl: async function(exchange, dataMessage) {
            const thread = this.getThread(exchange.threadId);
            if (!thread) {
                F.util.reportWarning('Skipping thread update for missing thread', {
                    exchange,
                    dataMessage
                });
                return;
            }
            console.info('Applying thread updates:', exchange.data.threadUpdates, thread);
            await thread.applyUpdates(exchange.data.threadUpdates);
            await thread.save();
        },

        _handleThreadArchiveControl: async function(exchange, dataMessage) {
            const thread = this.getThread(exchange.threadId);
            if (!thread) {
                console.warn('Skipping thread archive for missing thread:', exchange.threadId);
                return;
            }
            if (F.mainView && F.mainView.isThreadOpen(thread)) {
                F.mainView.openDefaultThread();
            }
            await thread.destroy();
        },

        _handlePreMessageCheck: async function(exchange, dataMessage) {
            console.info("Handling pre-message request:", exchange);
            const sender = await this.getSender();
            if (sender.get('pending')) {
                sender.unset('pending');
                await sender.save();
            } else {
                console.warn("Pre-message request from non pending user:", sender);
            }
        },

        markRead: async function(read, save) {
            if (this.get('read')) {
                // Already marked as read, nothing to do.
                return;
            }
            this.set('read', Date.now());
            if (this.get('expiration') && !this.get('expirationStart')) {
                this.set('expirationStart', read || Date.now());
            }
            F.notifications.remove(this.id);
            if (save !== false) {
                await this.save();
            }
            const thread = this.getThread();
            // This can race with thread removal...
            if (thread) {
                thread.trigger('read');
            }
        },

        markExpired: async function() {
            this.trigger('expired', this);
            const thread = this.getThread();
            // This can race with thread removal...
            if (thread) {
                thread.trigger('expired', this);
            }
            this.destroy();
        },

        isExpiring: function() {
            return this.get('expiration') && this.get('expirationStart');
        },

        msTilExpire: function() {
              if (!this.isExpiring()) {
                return Infinity;
              }
              var now = Date.now();
              var start = this.get('expirationStart');
              var delta = this.get('expiration') * 1000;
              var ms_from_now = start + delta - now;
              if (ms_from_now < 0) {
                  ms_from_now = 0;
              }
              return ms_from_now;
        },

        setToExpire: function() {
            if (this.isExpiring() && !this.expiration) {
                const ms_from_now = this.msTilExpire();
                setTimeout(this.markExpired.bind(this), ms_from_now);
            }
        },

        addDeliveryReceipt: async function(protocolReceipt) {
            return await this.addReceipt('delivery', {
                addr: protocolReceipt.get('sender'),
                device: protocolReceipt.get('senderDevice'),
            });
        },

        addSentReceipt: async function(desc) {
            return await this.addReceipt('sent', desc);
        },

        addErrorReceipt: async function(desc) {
            return await this.addReceipt('error', this._copyError(desc));
        },

        addReceipt: async function(type, attrs) {
            if (!attrs.timestamp) {
                attrs.timestamp = Date.now();
            }
            await this.receipts.add(Object.assign({
                messageId: this.id,
                type,
            }, attrs)).save();
        }
    });

    F.MessageCollection = F.SearchableCollection.extend({
        model: F.Message,
        database: F.Database,
        storeName: 'messages',
        comparator: x => -x.get('received'),

        initialize: function(models, options) {
            if (options) {
                this.thread = options.thread;
            }
        },

        destroyAll: async function () {
            // Must use copy of collection.models to avoid in-place mutation bugs
            // during model.destroy.
            const models = Array.from(this.models);
            await Promise.all(models.map(m => m.destroy()));
        },

        fetch: async function() {
            /* Make sure receipts are fully loaded too. */
            const ret = await Backbone.Collection.prototype.fetch.apply(this, arguments);
            await Promise.all(this.models.map(m => m.receiptsLoaded));
            return ret;
        },

        fetchSentAt: async function(timestamp) {
            await this.fetch({
                index: {
                    name: 'sent',
                    only: timestamp
                }
            });
        },

        fetchAll: async function() {
            await this.fetch({
                index: {
                    name: 'threadId-received',
                    lower: [this.thread.id],
                    upper: [this.thread.id, Number.MAX_VALUE],
                }
            });
        },

        fetchByMember: async function(memberId) {
            await this.fetch({
                index: {
                    name: 'member',
                    only: memberId
                }
            });
        },

        fetchPage: async function(limit) {
            if (typeof limit !== 'number') {
                limit = 25;
            }
            const threadId = this.thread.id;
            let upper;
            let reset;
            if (this.length === 0) {
                // fetch the most recent messages first
                upper = Number.MAX_VALUE;
                reset = true; // Faster rendering.
            } else {
                // not our first rodeo, fetch older messages.
                upper = this.at(this.length - 1).get('received');
            }
            await this.fetch({
                remove: false,
                reset,
                limit,
                index: {
                    name  : 'threadId-received',
                    lower : [threadId],
                    upper : [threadId, upper],
                    order : 'desc'
                }
            });
        },

        totalCount: async function() {
            const db = await F.util.idbRequest(indexedDB.open(F.Database.id));
            const t = db.transaction(this.storeName);
            const store = t.objectStore(this.storeName);
            if (this.thread) {
                const index = store.index('threadId-received');
                const bounds = IDBKeyRange.bound([this.thread.id, 0], [this.thread.id, Number.MAX_VALUE]);
                return await F.util.idbRequest(index.count(bounds));
            } else {
                return await F.util.idbRequest(store.count());
            }
        }
    });

    F.MessageReceipt = Backbone.Model.extend({
        database: F.Database,
        storeName: 'receipts'
    });

    F.MessageReceiptCollection = Backbone.Collection.extend({
        model: F.MessageReceipt,
        database: F.Database,
        storeName: 'receipts',

        initialize: function(models, options) {
            this.message = options.message;
        },

        fetchAll: async function() {
            if (!this.message.id) {
                return;
            }
            await this.fetch({
                index: {
                    name: 'messageId',
                    only: this.message.id
                }
            });
        },
    });
})();
