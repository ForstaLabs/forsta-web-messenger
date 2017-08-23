// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    function makeInvalidUser(label) {
        console.warn("Making invalid user:", label);
        const user = new F.User({
            id: 'INVALID-' + label,
            first_name: 'Invalid User',
            last_name: `(${label})`,
            email: 'support@forsta.io'
        });
        user.getColor = () => 'red';
        user.getAvatarURL = () => F.util.textAvatar('⚠', user.getColor());
        return user;
    }

    F.Message = Backbone.Model.extend({
        database: F.Database,
        storeName: 'messages',
        handlerMap: {
            control: '_handleControl',
            receipt: '_handleReceipt',
            conversation: '_handleConversation',
            announcement: '_handleAnnouncement',
            poll: '_handlePoll',
            pollResponse: '_handlePollResponse',
            discover: '_handleDiscover',
            discoverResponse: '_handleDiscoverResponse'
        },

        initialize: function() {
            this.receipts = new F.ReceiptCollection([], {
                message: this
            });
            this.receiptsLoaded = this.receipts.fetchAll();
            this.on('change:attachments', this.updateImageUrl);
            this.on('destroy', this.revokeImageUrl);
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

        isIncoming: function() {
            return this.get('type') === 'incoming';
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
            if (this.isIncoming() && this.hasKeyConflicts()) {
                meta.push('Received message with unknown identity key');
            }
            if (this.isExpirationUpdate()) {
                const t = this.get('expirationUpdate').expiration;
                if (t) {
                    const human_time = F.tpl.help.humantime(t);
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
            if (this.isIncoming() && this.hasErrors() && !meta.length) {
                meta.push('Error handling incoming message');
            }
            if (this.get('type') === 'clientOnly') {
                meta.push('Only visible to you');
            }
            return meta;
        },

        getNotificationText: function() {
            var meta = this.getMeta();
            if (meta.length) {
                return meta.join(', ');
            } else {
                return this.get('plain') || '';
            }
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
            return this.getThread().messages.get(this.id);
        },

        getSender: function() {
            // XXX Maybe this should not return invalid user and make caller do that.
            const userId = this.get('sender');
            return F.foundation.getUsers().get(userId) || makeInvalidUser('userId:' + userId);
        },

        getUserFromProtoAddr: function(addr) {
            // XXX Different handling than getSender...
            return F.foundation.getUsers().getFromProtoAddr(addr);
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

        hasKeyConflict: function(addr) {
            return _.any(this.get('errors'), function(e) {
                return (e.name === 'IncomingIdentityKeyError' ||
                        e.name === 'OutgoingIdentityKeyError') &&
                        e.addr === addr;
            });
        },

        getKeyConflict: function(addr) {
            return _.find(this.get('errors'), function(e) {
                return (e.name === 'IncomingIdentityKeyError' ||
                        e.name === 'OutgoingIdentityKeyError') &&
                        e.addr === addr;
            });
        },

        send: async function(sendMessageJob) {
            this.trigger('pending');
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
                this.get('sent'), this.get('destination'),
                this.get('expirationStart'));
        },

        _copyError: function(errorDesc) {
            /* Serialize the errors for storage to the DB. */
            console.assert(errorDesc.error instanceof Error);
            return {
                timestamp: errorDesc.timestamp,
                error: _.pick(errorDesc.error, 'name', 'message', 'code', 'addr',
                              'reason', 'functionCode', 'args', 'stack')
            };
        },

        addError: async function(error) {
            console.assert(error instanceof Error);
            const errors = Array.from(this.get('errors') || []);
            errors.push({
                timestamp: Date.now(),
                error
            });
            await this.save({errors});
        },

        removeConflictFor: function(addr) {
            var errors = _.reject(this.get('errors'), function(e) {
                return e.addr === addr &&
                    (e.name === 'IncomingIdentityKeyError' ||
                     e.name === 'OutgoingIdentityKeyError');
            });
            this.set({errors: errors});
        },

        hasNetworkError: function(addr) {
            var error = _.find(this.get('errors'), function(e) {
                return (e.name === 'MessageError' ||
                        e.name === 'OutgoingMessageError' ||
                        e.name === 'SendMessageNetworkError');
            });
            return !!error;
        },

        removeOutgoingErrors: function(addr) {
            var errors = _.partition(this.get('errors'), function(e) {
                return e.addr === addr &&
                    (e.name === 'MessageError' ||
                     e.name === 'OutgoingMessageError' ||
                     e.name === 'SendMessageNetworkError');
            });
            this.set({errors: errors[1]});
            return errors[0][0];
        },

        resend: function(addr) {
            var error = this.removeOutgoingErrors(addr);
            if (error) {
                this.send(new textsecure.ReplayableError(error).replay());
            }
        },

        resolveConflict: function(addr) {
            var error = this.getKeyConflict(addr);
            if (error) {
                this.removeConflictFor(addr);
                var promise = new textsecure.ReplayableError(error).replay();
                if (this.isIncoming()) {
                    promise = promise.then(function(content) {
                        this.removeConflictFor(addr);
                        return this.handleDataMessage(content.dataMessage);
                    }.bind(this));
                } else {
                    promise = this.send(promise).then(function() {
                        this.removeConflictFor(addr);
                        return this.save();
                    }.bind(this));
                }
                promise.catch(function(e) {
                    this.removeConflictFor(addr);
                    return this.addError(e);
                }.bind(this));

                return promise;
            }
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
            const handler = this[this.handlerMap[exchange.type]];
            if (!handler) {
                console.error("Invalid exchange type:", exchange.type, dataMessage);
                throw new Error("VIOLATION: Invalid/missing 'type'");
            }
            return F.queueAsync('message-handler', handler.bind(this, exchange, dataMessage));
        },

        _handleControl: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleReceipt: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleAnnouncement: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handlePoll: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handlePollResponse: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleDiscover: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleDiscoverResponse: async function(exchange, dataMessage) {
            throw new Error("XXX Not Implemented");
        },

        _handleConversation: async function(exchange, dataMessage) {
            const source = this.get('source');
            const incoming = this.get('type') === 'incoming';
            const notes = [];
            const threadId = exchange.threadId;
            if (!threadId) {
                console.error("Invalid message:", this, dataMessage);
                throw new Error("VIOLATION: Missing 'threadId'");
            }
            let thread = this.getThread(threadId);
            if (!thread) {
                console.info("Creating new thread:", threadId);
                thread = await F.foundation.getThreads().make({
                    id: threadId,
                    type: 'conversation',
                    title: exchange.threadTitle,
                    distribution: exchange.distribution,
                    distributionPretty: (await F.ccsm.resolveTags(exchange.distribution)).pretty
                });
            }
            if (!exchange.messageId) {
                notes.push("VIOLATION: Missing 'messageId'");
                exchange.messageId = F.util.uuid4();
            }
            if (!exchange.sender || !exchange.sender.userId) {
                notes.push("VIOLATION: Missing 'sender.userId'");
                exchange.sender = exchange.sender || {};
                exchange.sender.userId = this.getUserFromProtoAddr(source).id;
            }
            if (exchange.threadTitle != thread.get('title')) {
                thread.set('title', exchange.threadTitle);
                notes.push("Title changed to: " + exchange.threadTitle);
            }
            if (exchange.distribution != thread.get('distribution')) {
                // XXX Do better here once we have some better APIs for doing set math on distribution.
                notes.push("Distribution changed to: " + exchange.distribution);
            }
            this.set({
                id: exchange.messageId,
                sender: exchange.sender.userId,
                userAgent: exchange.userAgent,
                plain: exchange.getText && exchange.getText('plain'),
                html: exchange.getText && exchange.getText('html'),
                threadId: thread.id,
                attachments: this.parseAttachments(exchange, dataMessage.attachments),
                flags: dataMessage.flags,
                notes,
                errors: [],
            });
            /* Sometimes the delivery receipts and read-syncs arrive before we get the message
             * itself.  Drain any pending actions from their queue and associate them now. */
            if (!incoming) {
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
                    source,
                    expiration: this.get('expiration')
                });
                thread.set('expiration', this.get('expiration'));
            }
            thread.set('timestamp', Math.max(thread.get('timestamp') || 0, this.get('sent')));
            thread.set('lastMessage', this.getNotificationText());
            await Promise.all([this.save(), thread.save()]);
            thread.addMessage(this);
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
            F.notifications.remove(F.notifications.where({
                messageId: this.id
            }));
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
                var ms_from_now = this.msTilExpire();
                setTimeout(this.markExpired.bind(this), ms_from_now);
            }
        },

        addDeliveryReceipt: async function(receiptDescModel) {
            return await this.addReceipt('delivery', {
                source: receiptDescModel.get('source'),
                sourceDevice: receiptDescModel.get('sourceDevice'),
            });
        },

        addSentReceipt: async function(desc) {
            return await this.addReceipt('sent', desc);
        },

        addErrorReceipt: async function(desc) {
            return await this.addReceipt('error', this._copyError(desc));
        },

        addReceipt: async function(type, attrs) {
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
                limit = 40;
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

        hasKeyConflicts: function() {
            return this.any(m => m.hasKeyConflicts());
        }
    });
})();
