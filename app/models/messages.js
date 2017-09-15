// vim: ts=4:sw=4:expandtab
/* global Raven */

(function () {
    'use strict';

    self.F = self.F || {};

    function makeInvalidUser(label) {
        console.warn("Making invalid user:", label);
        const user = new F.User({
            id: 'INVALID-' + label,
            first_name: 'Invalid User',
            last_name: `(${label})`,
            email: 'support@forsta.io',
            gravatar_hash: 'ec055ce3445bb52d3e972f8447b07a68'
        });
        user.getColor = () => 'red';
        user.getAvatarURL = () => F.util.textAvatarURL('⚠', user.getColor());
        return user;
    }

    F.Message = Backbone.Model.extend({
        database: F.Database,
        storeName: 'messages',
        threadHandlerMap: {
            control: '_handleControlThread',
            conversation: '_handleConversationThread',
            announcement: '_handleConversationThread'
        },
        messageHandlerMap: {
            content: '_handleContentMessage',
            control: '_handleControlMessage',
            receipt: '_handleReceiptMessage',
            poll: '_handlePollMessage',
            pollResponse: '_handlePollResponseMessage',
            discover: '_handleDiscoverMessage',
            discoverResponse: '_handleDiscoverResponseMessage'
        },

        initialize: function() {
            this.receipts = new F.ReceiptCollection([], {
                message: this
            });
            this.receiptsLoaded = this.receipts.fetchAll();
            this.on('destroy', this.revokeImageUrl);
            this.on('change:attachments', this.updateImageUrl);
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
            if (attrs.html) {
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
            const flag = textsecure.protobuf.DataMessage.Flags.END_SESSION;
            return !!(this.get('flags') & flag);
        },

        isExpirationUpdate: function() {
            const expire = textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE;
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

        getThread: function(threadId) {
            /* Get a thread model for this message. */
            threadId = threadId || this.get('threadId');
            return F.foundation.getThreads().get(threadId);
        },

        getThreadMessage: function() {
            /* Return this same message but from a thread collection.  Note that
             * it's entirely possible if not likely that this returns self or undefined. */
            const thread = this.getThread();
            return thread && thread.messages.get(this.id);
        },

        getSender: async function() {
            const userId = this.get('sender');
            const user = await F.ccsm.userLookup(userId);
            return user || makeInvalidUser('userId:' + userId);
        },

        hasErrors: function() {
            return !!this.receipts.findWhere({type: 'error'});
        },

        send: async function(sendMessageJob) {
            const outmsg = await sendMessageJob;
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
            await F.queueAsync('message-send-sync-' + this.id,
                               this._sendSyncMessage.bind(this, outmsg.message));
        },

        _sendSyncMessage: async function(content) {
            /* Do not run directly, use queueAsync. */
            console.assert(!this.get('synced'));
            console.assert(content);
            return await F.foundation.getMessageSender().sendSyncMessage(content,
                this.get('sent'), this.get('threadId'), this.get('expirationStart'));
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
                'threadType',
                'messageType',
                'sender',
                'threadId',
                'messageId',
                'distribution'
            ]);
            const missing = requiredAttrs.difference(new F.util.ESet(Object.keys(exchange)));
            if (missing.size) {
                console.error("Message Exchange Violation: Missing", Array.from(missing), dataMessage);
                Raven.captureMessage("Message Exchange Violation: Missing", {
                    level: 'warning',
                    extra: {
                        model: this.attributes,
                        dataMessage: dataMessage
                    }
                });
                F.util.promptModal({
                    icon: 'red warning circle big',
                    header: 'Message Exchange Violation',
                    content: [
                        'Missing message attributes:',
                        `<div class="json">${JSON.stringify(Array.from(missing), null, '  ')}</div>`,
                        'Message Data:',
                        `<div class="json">${JSON.stringify(dataMessage, null, '  ')}</div>`,
                        'Message Model:',
                        `<div class="json">${JSON.stringify(this, null, '  ')}</div>`
                    ].join('<br/>')
                });
                return;
            }
            const threadHandler = this[this.threadHandlerMap[exchange.threadType]];
            if (!threadHandler) {
                console.error("Invalid exchange threadType:", exchange.threadType, dataMessage);
                throw new Error("VIOLATION: Invalid/missing 'threadType'");
            }
            return F.queueAsync('thread-handler', threadHandler.bind(this, exchange, dataMessage));
        },

        _handleControlThread: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleConversationThread: async function(exchange, dataMessage) {
            const notes = [];
            this.set('notes', notes);
            let thread = this.getThread(exchange.threadId);
            if (!thread) {
                console.info("Creating new thread:", exchange.threadId);
                thread = await F.foundation.getThreads().make(exchange.distribution.expression, {
                    id: exchange.threadId,
                    type: exchange.threadType,
                    title: exchange.threadTitle,
                });
            }
            const title = exchange.threadTitle || undefined; // Use a single falsy type.
            if (title !== thread.get('title')) {
                if (!title) {
                    notes.push("Title cleared");
                } else {
                    notes.push("Title updated: " + exchange.threadTitle);
                }
                thread.set('title', title);
            }
            if (exchange.distribution.expression != thread.get('distribution')) {
                const normalized = await F.ccsm.resolveTags(exchange.distribution.expression);
                if (normalized.universal !== exchange.distribution.expression) {
                    console.error("Non-universal expression sent by peer:",
                                  exchange.distribution.expression);
                }
                notes.push("Distribution changed to: " + normalized.pretty);
                thread.set('distribution', exchange.distribution.expression);
            }
            const messageHandler = this[this.messageHandlerMap[exchange.messageType]];
            await messageHandler.call(this, thread, exchange, dataMessage);
        },

        _handleContentMessage: async function(thread, exchange, dataMessage) {
            this.set({
                id: exchange.messageId,
                type: exchange.messageType,
                sender: exchange.sender.userId,
                userAgent: exchange.userAgent,
                members: await thread.getMembers(),
                plain: exchange.getText && exchange.getText('plain'),
                html: exchange.getText && exchange.getText('html'),
                threadId: thread.id,
                attachments: this.parseAttachments(exchange, dataMessage.attachments),
                flags: dataMessage.flags
            });
            /* Sometimes the delivery receipts and read-syncs arrive before we get the message
             * itself.  Drain any pending actions from their queue and associate them now. */
            if (!this.get('incoming')) {
                for (const x of F.deliveryReceiptQueue.drain(this)) {
                    await this.addDeliveryReceipt(x);
                }
            } else {
                if (F.readReceiptQueue.drain(this).length) {
                    await this.markRead(null, /*save*/ false);
                } else {
                    thread.set('unreadCount', thread.get('unreadCount') + 1);
                }
            }
            if (this.isExpirationUpdate()) {
                this.set('expirationUpdate', {
                    source: this.get('source'),
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

        _handleReceiptMessage: async function(thread, exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleAnnouncement: async function(thread, exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handlePollMessage: async function(thread, exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handlePollResponseMessage: async function(thread, exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleDiscoverMessage: async function(thread, exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleDiscoverResponseMessage: async function(thread, exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleControlMessage: async function(thread, exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        markRead: async function(read, save) {
            if (this.get('read')) {
                console.warn("Already marked as read.  nothing to do.", this);
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
            this.getThread().trigger('read');
        },

        markExpired: async function() {
            this.trigger('expired', this);
            this.getThread().trigger('expired', this);
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

        addDeliveryReceipt: async function(receiptDescModel) {
            return await this.addReceipt('delivery', {
                addr: receiptDescModel.get('source'),
                device: receiptDescModel.get('sourceDevice'),
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
            const receipt = new F.Receipt(Object.assign({
                messageId: this.id,
                type,
            }, attrs));
            await receipt.save();
            this.receipts.add(receipt);
        }
    });

    F.MessageCollection = Backbone.Collection.extend({
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
                    name  : 'threadId-received',
                    lower : [this.thread.id],
                    upper : [this.thread.id, Number.MAX_VALUE],
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
            const db = await this.idbPromise(indexedDB.open(F.Database.id));
            const t = db.transaction(db.objectStoreNames);
            const store = t.objectStore(this.storeName);
            const index = store.index('threadId-received');
            const bounds = IDBKeyRange.bound([this.thread.id, 0], [this.thread.id, Number.MAX_VALUE]);
            return await this.idbPromise(index.count(bounds));
        },

        idbPromise: async function(req) {
            const p = new Promise((resolve, reject) => {
                req.onsuccess = ev => resolve(ev.target.result);
                req.onerror = ev => reject(new Error(ev.target.errorCode));
            });
            return await p;
        }
    });
})();
