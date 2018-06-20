// vim: ts=4:sw=4:expandtab
/* global relay Backbone */

(function () {
    'use strict';

    self.F = self.F || {};

    class StopHandler {
        constructor(message) {
            this.message = message;
        }

        toString() {
            return this.message;
        }
    }


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
                const thread = await model.getThread();
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
            control: '_handleControlMessage'
        },

        controlHandlerMap: {
            discover: '_handleDiscoverControl',
            provisionRequest: '_handleProvisionRequestControl',
            threadUpdate: '_handleThreadUpdateControl',
            threadArchive: '_handleThreadArchiveControl',
            threadRestore: '_handleThreadRestoreControl',
            threadExpunge: '_handleThreadExpungeControl',
            preMessageCheck: '_handlePreMessageCheckControl',
            syncRequest: '_handleSyncRequestControl',
            syncResponse: '_handleSyncResponseControl',
            userBlock: '_handleUserBlockControl',
            userUnblock: '_handleUserUnblockControl',
            callOffer: '_handleCallOfferControl',
            callAcceptOffer: '_handleCallAcceptOfferControl',
            callICECandidate: '_handleCallICECandidateControl',
            callLeave: '_handleCallLeaveControl',
        },

        initialize: function() {
            this.receipts = new F.MessageReceiptCollection([], {message: this});
            this.receiptsLoaded = this.receipts.fetchAll();
            this.replies = new F.MessageReplyCollection([], {message: this});
            this.repliesLoaded = this.replies.fetchAll();
            this.on('change:expirationStart', this.setToExpire);
            this.on('change:expiration', this.setToExpire);
            this.setToExpire();
        },

        defaults: function() {
            const now = Date.now();
            return {
                sent: now,
                received: now,
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
            return F.SearchableModel.prototype.set.call(this, attrs, options);
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
            const att = this.get('attachments') || [];
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
            if (this.get('expiration')) {
                meta.push('Expiring message');
            }
            return meta;
        },

        getNotificationText: function() {
            if (this.get('expiration')) {
                return '(Expiring message)';
            }
            const text = this.get('plain');
            if (text) {
                return text;
            }
            const meta = this.getMeta();
            return meta.length ? `(${meta.join(', ')})` : '';
        },

        getThread: async function(threadId, options) {
            /* Get the thread for this message. */
            options = options || {};
            threadId = threadId || this.get('threadId');
            let thread = F.foundation.allThreads.get(threadId);
            if (!thread && options.includeArchived) {
                thread = new F.Thread({id: threadId}, {deferSetup: true});
                try {
                    await thread.fetch();
                } catch(e) {
                    if (e instanceof ReferenceError) {
                        return;
                    } else {
                        throw e;
                    }
                }
                thread.setup();
            }
            return thread;
        },

        getThreadMessage: async function() {
            /* Return this same message but from a thread collection.  Note that
             * it's entirely possible if not likely that this returns self or undefined. */
            const thread = await this.getThread();
            return thread && thread.messages.get(this.id);
        },

        getSender: async function() {
            const userId = this.get('sender');
            if (!userId) {
                return;
            }
            const user = await F.atlas.getContact(userId);
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
                    id: attx.id.toString(),
                    key: attx.key.toArrayBuffer(),
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
            F.queueAsync(queue, async () => {
                try {
                    await messageHandler.call(this, exchange, dataMessage);
                } catch(e) {
                    if (e instanceof StopHandler) {
                        console.debug('Handler stopped by: ' + e);
                        return;
                    }
                    F.util.reportError('Message Handler Error: ' + e, {
                        error: e,
                        exchange,
                        dataMessage
                    });
                    throw e;
                }
            });
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

        _updateOrCreateThread: async function(exchange, options) {
            let thread = await this.getThread(exchange.threadId, options);
            if (!thread) {
                console.info("Creating new thread:", exchange.threadId);
                thread = await F.foundation.allThreads.make(exchange.distribution.expression, {
                    id: exchange.threadId,
                    type: exchange.threadType,
                    title: exchange.threadTitle || undefined,
                });
            }
            if (thread.get('blocked')) {
                console.warn("Skipping updates for blocked: " + thread);
            } else {
                await thread.applyUpdates(exchange);
            }
            return thread;
        },

        _getConversationThread: async function(exchange, options) {
            return await this._updateOrCreateThread(exchange, options);
        },

        _getAnnouncementThread: async function(exchange, options) {
            let thread = await this.getThread(exchange.threadId, options);
            if (!thread) {
                if (exchange.messageRef) {
                    console.error('We do not have the announcement thread this message refers to!');
                    return;
                } else {
                    thread = await F.foundation.allThreads.make(exchange.distribution.expression, {
                        id: exchange.threadId,
                        type: exchange.threadType,
                        title: exchange.threadTitle,
                        sender: this.get('sender'),
                        sent: true,
                        disableResponses: exchange.disableResponses,
                        privateResponses: exchange.privateResponses
                    });
                }
            }
            return await this._updateOrCreateThread(exchange);
        },

        _ensureThread: async function(exchange) {
            const getThread = {
                conversation: this._getConversationThread,
                announcement: this._getAnnouncementThread
            }[exchange.threadType];
            if (!getThread) {
                throw new TypeError("Invalid threadtype: " + exchange.threadType);
            }
            const thread = await getThread.call(this, exchange, {includeArchived: true});
            if (thread.get('blocked') && !this.isFromSelf()) {
                console.warn("Message for blocked: " + thread);
                return;
            }
            if (thread.get('archived')) {
                await thread.restore({silent: true});
            }
            return thread;
        },

        _handleContentMessage: async function(exchange, dataMessage) {
            const thread = await this._ensureThread(exchange);
            if (!thread) {
                return;
            }
            this.set({
                id: exchange.messageId,
                type: exchange.messageType,
                messageRef: exchange.messageRef,
                userAgent: exchange.userAgent,
                members: await thread.getMembers(),
                plain: exchange.getText && exchange.getText('plain'),
                html: exchange.getText && exchange.getText('html'),
                threadId: thread.id,
                attachments: this.parseAttachments(exchange, dataMessage.attachments),
                flags: dataMessage.flags,
                mentions: exchange.data && exchange.data.mentions,
                vote: exchange.data && exchange.data.vote,
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
            await this.save();
            await thread.addMessage(this);
        },

        _handleDiscoverControl: async function(exchange, dataMessage) {
            const threads = F.foundation.allThreads;
            const matches = threads.findWhere(exchange.distribution.expresssion,
                                              exchange.threadType);
            const msgSender = F.foundation.getMessageSender();
            const now = Date.now();
            await msgSender.send({
                addrs: [this.get('sender')],
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

        _handleProvisionRequestControl: async function(exchange, dataMessage) {
            const requestedBy = this.get('sender');
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
            const thread = await this.getThread(exchange.threadId, {includeArchived: true});
            if (!thread) {
                console.warn('Skipping thread update for missing thread:', exchange.threadId);
                return;
            }
            if (thread.get('blocked') && !this.isFromSelf()) {
                console.warn("Dropping incoming update for blocked: " + thread);
                return;
            }
            console.info('Applying updates to: ' + thread, exchange.data.threadUpdates);
            const includePrivate = this.isFromSelf();
            await thread.applyUpdates(exchange.data.threadUpdates, {includePrivate});
            await thread.save();
        },

        _handleThreadArchiveControl: async function(exchange, dataMessage) {
            const thread = await this.getThread(exchange.threadId);
            if (thread) {
                if (F.mainView && F.mainView.isThreadOpen(thread)) {
                    F.mainView.openDefaultThread();
                }
                console.warn("Archiving thread: " + thread);
                await thread.archive({silent: true});
            }
        },

        _handleThreadRestoreControl: async function(exchange, dataMessage) {
            const thread = await this.getThread(exchange.threadId, {includeArchived: true});
            if (thread && thread.get('archived')) {
                console.info("Restoring archived thread: " + thread);
                await thread.restore({silent: true});
            }
        },

        _handleThreadExpungeControl: async function(exchange, dataMessage) {
            const thread = await this.getThread(exchange.threadId, {includeArchived: true});
            if (thread) {
                if (F.mainView && F.mainView.isThreadOpen(thread)) {
                    F.mainView.openDefaultThread();
                }
                console.warn("Expunging thread: " + thread);
                await thread.expunge({silent: true});
            }
        },

        _handlePreMessageCheckControl: async function(exchange, dataMessage) {
            console.info("Handling pre-message request:", exchange);
            const sender = await this.getSender();
            if (sender.get('pending')) {
                sender.unset('pending');
                await sender.save();
            } else {
                console.warn("Pre-message request from non pending user:", sender);
            }
        },

        _assertIsFromSelf: function() {
            if (!this.isFromSelf()) {
                throw new Error("Imposter");
            }
        },

        isFromSelf: function() {
            return this.get('sender') === F.currentUser.id;
        },

        _handleSyncRequestControl: async function(exchange, dataMessage) {
            this._assertIsFromSelf();
            if (exchange.data.devices && exchange.data.devices.indexOf(F.currentDevice) === -1) {
                console.debug("Dropping sync request not intended for our device.");
                return;
            }
            const ev = new Event('syncRequest');
            ev.id = exchange.threadId;
            ev.data = {
                exchange,
                message: this
            };
            dispatchEvent(ev);
        },

        _handleSyncResponseControl: async function(exchange, dataMessage) {
            this._assertIsFromSelf();
            const ev = new Event('syncResponse');
            ev.id = exchange.threadId;
            ev.data = {
                exchange,
                message: this,
                attachments: dataMessage.attachments,
            };
            dispatchEvent(ev);
        },

        _handleUserBlockControl: async function(exchange, dataMessage) {
            this._assertIsFromSelf();
            const contact = await F.atlas.getContact(exchange.data.userId);
            await contact.save({blocked: true});
        },

        _handleUserUnblockControl: async function(exchange, dataMessage) {
            this._assertIsFromSelf();
            const contact = await F.atlas.getContact(exchange.data.userId);
            await contact.save({blocked: false});
        },

        _handleCallOfferControl: async function(exchange, dataMessage) {
            const thread = await this._ensureThread(exchange, dataMessage);
            if (!thread) {
                throw new StopHandler("call offer from invalid thread");
            }
            // NOTE this is vulnerable to client side clock differences.  Clients with
            // bad clocks are going to have a bad day.  Server based timestamps would
            // be helpful here.
            if (F.mainView && this.get('sent') > Date.now() - (60 * 1000)) {
                await F.util.answerCall(this.get('sender'), thread, exchange.data);
            }
        },

        _requireCallView: async function(exchange) {
            // Get the active and matching CallView for this message or stop
            // handler processing if not found.
            const thread = await this.getThread(exchange.threadId);
            if (!thread) {
                throw new StopHandler("call for invalid thread");
            }
            if (!F.activeCall || F.activeCall.callId !== exchange.data.callId) {
                throw new StopHandler("call is not active");
            }
            return F.activeCall;
        },

        _handleCallAcceptOfferControl: async function(exchange, dataMessage) {
            const callView = await this._requireCallView(exchange);
            callView.trigger('peeracceptoffer', this.get('sender'), exchange.data);
        },

        _handleCallICECandidateControl: async function(exchange, dataMessage) {
            const callView = await this._requireCallView(exchange);
            callView.trigger('peericecandidate', this.get('sender'), exchange.data);
        },

        _handleCallLeaveControl: async function(exchange, dataMessage) {
            const callView = await this._requireCallView(exchange);
            callView.trigger('peerleave', this.get('sender'), exchange.data);
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
            const thread = await this.getThread();
            // This can race with thread removal...
            if (thread) {
                thread.trigger('read');
            }
        },

        markExpired: async function() {
            this.trigger('expired', this);
            const thread = await this.getThread();
            // This can race with thread removal...
            if (thread) {
                thread.trigger('expired', this);
            }
            this.destroy();
        },

        isExpiring: function() {
            return !!(this.get('expiration') && this.get('expirationStart'));
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
        },

        loadAttachment: async function(id) {
            const attachment = this.get('attachments').find(x => x.id === id);
            if (!attachment) {
                throw ReferenceError("Attachment Not Found");
            }
            const mr = F.foundation.getMessageReceiver();
            attachment.data = await mr.fetchAttachment(attachment);
            await this.save();
            return attachment.data;
        },

        addReply: async function(message) {
            const replies = Array.from(this.get('replies') || []);
            replies.push(message.id);
            this.replies.add(message);
            await this.save({replies});
        },

        addVote: async function(value) {
            if (typeof value !== 'number') {
                throw new TypeError("Vote must be number");
            }
            const score = this.get('score') || 0;
            await this.save('score', score + value);
        }
    });

    F.MessageCollection = F.SearchableCollection.extend({
        model: F.Message,
        database: F.Database,
        storeName: 'messages',
        pageSize: 25,

        comparator: function(a, b) {
            const aRecv = a.get('received') || 0;
            const bRecv = b.get('received') || 0;
            return bRecv - aRecv;
        },

        initialize: function(models, options) {
            if (options) {
                this.threadId = options.threadId || (options.thread && options.thread.id);
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
            await Promise.all(this.models.map(m => m.receiptsLoaded.then(m.repliesLoaded)));
            return ret;
        },

        fetchAll: async function() {
            await this.fetch({
                reset: true,
                index: {
                    name: 'threadId-received',
                    lower: [this.threadId],
                    upper: [this.threadId, Infinity],
                    order : 'desc'
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
                limit = this.pageSize;
            }
            let upper;
            let reset;
            let excludeUpper;
            if (this.length === 0) {
                // fetch the most recent messages first
                upper = Infinity;
                reset = true; // Faster rendering.
            } else {
                // not our first rodeo, fetch older messages.
                upper = this.at(this.length - 1).get('received');
                excludeUpper = true;
            }
            await this.fetch({
                remove: false,
                reset,
                limit,
                filter: x => !x.messageRef,
                index: {
                    name  : 'threadId-received',
                    lower : [this.threadId],
                    upper : [this.threadId, upper],
                    excludeUpper,
                    order : 'desc'
                }
            });
        },

        fetchToReceived: async function(received) {
            let upperReceived;
            let reset;
            if (this.length === 0) {
                // First fetch, use reset for speed.
                upperReceived = Infinity;
                reset = true; // Faster rendering.
            } else {
                // not our first rodeo, fetch only older messages.
                upperReceived = this.at(this.length - 1).get('received');
                if (upperReceived <= received) {
                    return;  // Already paged in.
                }
            }
            await this.fetch({
                remove: false,
                reset,
                filter: x => !x.messageRef,
                index: {
                    name  : 'threadId-received',
                    lower : [this.threadId, received],
                    upper : [this.threadId, upperReceived],
                    order : 'desc'
                }
            });
        },

        totalCount: async function() {
            const db = await F.util.idbRequest(indexedDB.open(F.Database.id));
            const t = db.transaction(this.storeName);
            const store = t.objectStore(this.storeName);
            if (this.threadId) {
                const index = store.index('threadId-received');
                const bounds = IDBKeyRange.bound([this.threadId], [this.threadId, Infinity]);
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


    F.MessageReplyCollection = Backbone.Collection.extend({
        model: F.Message,
        database: F.Database,
        storeName: 'messages',

        initialize: function(models, options) {
            this.message = options.message;
        },

        fetchAll: async function() {
            if (!this.message.id) {
                return;
            }
            const ids = this.message.get('replies');
            if (!ids || !ids.length) {
                return;
            }
            const models = ids.map(id => new F.Message({id}));
            await Promise.all(models.map(m => m.fetch()));
            this.reset(models);
        },
    });

})();
