// vim: ts=4:sw=4:expandtab
/* global relay Backbone */

(function () {
    'use strict';

    self.F = self.F || {};

    const logger = F.log.getLogger('models.messages');
    logger.setLevel('debug');


    class StopHandler {
        constructor(message) {
            this.message = message;
        }

        toString() {
            return this.message;
        }
    }

    const scheduleReadSync = F.buffered(async args => {
        // Dedup the arguments buffer.
        const reads = Array.from((new Map(args.map(x => [JSON.stringify(x[0]), x[0]]))).values());
        const threads = new Map();
        for (const x of reads) {
            if (!threads.has(x.thread.id) || threads.get(x.thread.id).timestamp < x.timestamp) {
                threads.set(x.thread.id, x);
            }
        }
        logger.debug(`Sending read-marks to ${threads.size} threads`);
        await Promise.all(Array.from(threads.values()).map(async x => {
            await x.thread.sendControl({
                control: 'readMark',
                readMark: x.timestamp,
            });
        }));
        logger.debug(`Syncing ${reads.length} read receipts`);
        if (F.openerRPC) {
            await F.openerRPC.invokeCommand('sync-read-messages', reads.map(x => ({
                timestamp: x.timestamp,
                sender: x.sender
            })));
        } else {
            const sender = F.foundation.getMessageSender();
            await sender.syncReadMessages(reads);
        }
    }, 100, {max: 5000});


    let _retransmitted = new Set();
    let _retransmitQueues;
    async function schedRetransmit(addr, retransmit) {
        if (_retransmitted.has(addr + retransmit)) {
            F.util.reportWarning("Retransmit loop detected for:", addr, retransmit);
            return;
        }
        if (_retransmitQueues) {
            if (_retransmitQueues.has(addr)) {
                _retransmitQueues.get(addr).add(retransmit);
            } else {
                _retransmitQueues.set(addr, new Set([retransmit]));
            }
            return;
        }
        _retransmitQueues = new Map([[addr, new Set([retransmit])]]);
        const mr = F.foundation.getMessageReceiver();
        await mr.idle;
        try {
            while (_retransmitQueues.size) {
                for (const [addr, retransmits] of Array.from(_retransmitQueues.entries())) {
                    _retransmitQueues.delete(addr);
                    for (const x of retransmits) {
                        _retransmitted.add(addr + x);
                        try {
                            await _retransmitMessage(addr, x);
                        } catch(e) {
                            F.util.reportError("Unexpected error during message retransmit", {error: e});
                        }
                    }
                }
            }
        } finally {
            _retransmitQueues = null;
        }
    }


    async function _retransmitMessage(addr, sent) {
        const msg = new F.Message({sent});
        try {
            await msg.fetch();
        } catch(e) {
            logger.warn("Message not found for retransmit request:", sent);
            return;
        }
        const thread = await msg.getThread();
        if (!thread) {
            logger.warn("Invalid thread for retransmit request:", msg.get('threadId'));
            return;
        }
        logger.warn(`Retransmitting message ${sent} for ${addr}`);
        await thread.resendMessage(msg, {addrs: [addr]});
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
                    return to.map(x => x.getName() + ' ' + x.getTagSlug({full: true})).join(' ');
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
            callJoin: '_handleCallJoinControl',
            callOffer: '_handleCallOfferControl',
            callAcceptOffer: '_handleCallAcceptOfferControl',
            callICECandidates: '_handleCallICECandidatesControl',
            callLeave: '_handleCallLeaveControl',
            callHeartbeat: '_handleCallHeartbeatControl',
            closeSession: '_handleCloseSessionControl',
            readMark: '_handleReadMarkControl',
            pendingMessage: '_handlePendingMessageControl',
            beacon: '_handleBeaconControl',
        },

        initialize: function() {
            this.receipts = new F.MessageReceiptCollection([], {message: this});
            this.replies = new F.MessageReplyCollection([], {message: this});
            return F.SearchableModel.prototype.initialize.apply(this, arguments);
        },

        fetchRelated: async function() {
            await Promise.all([
                this.receipts.fetchAll(),
                this.replies.fetchAll()
            ]);
        },

        monitorExpiration: function() {
            this.on('change:expirationStart', this._setToExpire);
            this.on('change:expiration', this._setToExpire);
            this._setToExpire();
        },

        defaults: function() {
            const now = Date.now();
            return {
                sent: now,
                received: now,
                timestamp: F.foundation.getSignalTimestamp(),
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

        getSource: async function() {
            const userId = this.get('source');
            if (!userId) {
                return;
            }
            const user = await F.atlas.getContact(userId);
            return user || F.util.makeInvalidUser('userId:' + userId);
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

        watchSend: function(outmsg) {
            outmsg.on('sent', this.addSentReceipt.bind(this));
            outmsg.on('error', this.addErrorReceipt.bind(this));
            for (const x of outmsg.sent) {
                this.addSentReceipt(x); // bg async ok
            }
            for (const x of outmsg.errors) {
                this.addErrorReceipt(x); // bg async ok
            }
        },

        _copyError: function(errorDesc) {
            /* Serialize the errors for storage to the DB. */
            return Object.assign({
                timestamp: errorDesc.timestamp,
            }, _.pick(errorDesc.error, 'name', 'message', 'code', 'addr', 'reason', 'args', 'stack'));
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
                logger.warn("Legacy unstructured message content received!");
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
                'messageType'
            ]);
            const missing = requiredAttrs.difference(new F.util.ESet(Object.keys(exchange)));
            if (missing.size) {
                if (this.isEndSession()) {
                    logger.debug("Silencing empty end-session message:", dataMessage);
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
                        logger.debug('Handler stopped by: ' + e);
                        return;
                    }
                    F.util.reportError('Message Handler Error: ' + e, {
                        error: e,
                        exchange,
                        dataMessage,
                        message: this.attributes
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
                logger.info("Creating new thread:", exchange.threadId);
                thread = await F.foundation.allThreads.make(exchange.distribution.expression, {
                    id: exchange.threadId,
                    type: exchange.threadType,
                    title: exchange.threadTitle || undefined,
                });
            }
            if (thread.get('blocked')) {
                logger.warn("Skipping updates for blocked: " + thread);
            } else {
                await thread.applyUpdates(exchange, {source: this.get('sender')});
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
                    logger.error('We do not have the announcement thread this message refers to!');
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
            if (thread.get('blocked') && !this.isSelfSource()) {
                logger.warn("Message for blocked: " + thread);
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
            const sender = exchange.sender || {};
            this.set({
                id: exchange.messageId,
                type: exchange.messageType,
                sender: sender.userId || this.get('source'),
                senderDevice: sender.device || this.get('sourceDevice'),
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
                actions: exchange.data && exchange.data.actions,
                actionOptions: exchange.data && exchange.data.actionOptions,
                timestamp: exchange.timestamp || this.get('timestamp')
            });
            /* Sometimes the delivery receipts and read-syncs arrive before we get the message
             * itself.  Drain any pending actions from their queue and associate them now. */
            if (!this.get('incoming')) {
                for (const x of await F.drainDeliveryReceipts(this)) {
                    await this.addDeliveryReceipt(x);
                }
            } else {
                for (const x of await F.drainReadReceipts(this)) {
                    await this.markRead(x.get('read'), {save: false, sendSync: false});
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
                timestamp: now,
                threadId: exchange.threadId,
                body: [{
                    version: 1,
                    messageId: F.util.uuid4(),
                    messageType: 'discoverResponse',
                    threadId: exchange.threadId,
                    userAgent: F.userAgent,
                    sender: {
                        userId: F.currentUser.id,
                        device: F.currentDevice
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
            const requestedBy = this.get('source');
            if (F.env.SUPERMAN_NUMBER && requestedBy !== F.env.SUPERMAN_NUMBER) {
                F.util.reportError('Provision request received from untrusted address', {
                    requestedBy,
                    exchange,
                    dataMessage
                });
                return;
            }
            logger.info('Handling provision request:', exchange.data.uuid);
            const am = await F.foundation.getAccountManager();
            await am.linkDevice(exchange.data.uuid, atob(exchange.data.key));
            logger.info('Successfully linked with:', exchange.data.uuid);
        },

        _handleThreadUpdateControl: async function(exchange, dataMessage) {
            const thread = await this.getThread(exchange.threadId, {includeArchived: true});
            if (!thread) {
                logger.warn('Skipping thread update for missing thread:', exchange.threadId);
                return;
            }
            if (thread.get('blocked') && !this.isSelfSource()) {
                logger.warn("Dropping incoming update for blocked: " + thread);
                return;
            }
            logger.info('Applying updates to: ' + thread, exchange.data.threadUpdates);
            const includePrivate = this.isSelfSource();
            await thread.applyUpdates(exchange.data.threadUpdates, {
                includePrivate,
                source: this.get('source')
            });
            await thread.save();
        },

        _handleThreadArchiveControl: async function(exchange, dataMessage) {
            const thread = await this.getThread(exchange.threadId);
            if (thread) {
                logger.warn("Archiving thread: " + thread);
                await thread.archive({silent: true});
            }
        },

        _handleThreadRestoreControl: async function(exchange, dataMessage) {
            const thread = await this.getThread(exchange.threadId, {includeArchived: true});
            if (thread && thread.get('archived')) {
                logger.info("Restoring archived thread: " + thread);
                await thread.restore({silent: true});
            }
        },

        _handleThreadExpungeControl: async function(exchange, dataMessage) {
            const thread = await this.getThread(exchange.threadId, {includeArchived: true});
            if (thread) {
                logger.warn("Expunging thread: " + thread);
                await thread.expunge({silent: true});
            }
        },

        _handlePreMessageCheckControl: async function(exchange, dataMessage) {
            logger.info("Handling pre-message request:", exchange);
            const source = await this.getSource();
            if (source.get('pending')) {
                source.unset('pending');
                await source.save();
            } else {
                logger.warn("Pre-message request from non pending user:", source);
            }
        },

        _assertIsSelfSource: function() {
            if (!this.isSelfSource()) {
                throw new Error("Imposter");
            }
        },

        isSelfSource: function() {
            return this.get('source') === F.currentUser.id;
        },

        _handleSyncRequestControl: async function(exchange, dataMessage) {
            this._assertIsSelfSource();
            if (exchange.data.devices && exchange.data.devices.indexOf(F.currentDevice) === -1) {
                logger.debug("Dropping sync request not intended for our device.");
                return;
            }
            if (exchange.data && exchange.data.ttl) {
                this._stopIfOlderThan(exchange.data.ttl);
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
            this._assertIsSelfSource();
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
            this._assertIsSelfSource();
            const contact = await F.atlas.getContact(exchange.data.userId);
            await contact.save({blocked: true});
        },

        _handleUserUnblockControl: async function(exchange, dataMessage) {
            this._assertIsSelfSource();
            const contact = await F.atlas.getContact(exchange.data.userId);
            await contact.save({blocked: false});
        },

        _getCallManager: async function(exchange, dataMessage) {
            return await F.queueAsync('get-call-manager', async () => {
                const callId = exchange.data.callId;
                let callMgr = F.calling.getManager(callId);
                if (!callMgr) {
                    const thread = await this._ensureThread(exchange, dataMessage);
                    if (!thread) {
                        throw new StopHandler("call for invalid thread");
                    }
                    callMgr = F.calling.createManager(callId, thread);
                }
                return callMgr;
            });
        },

        _stopIfOlderThan: function(maxAge) {
            if (this.get('serverAge') > maxAge) {
                throw new StopHandler(`Stale message from: ${this.get('source')}.${this.get('sourceDevice')}`);
            }
        },

        _handleCallJoinControl: async function(exchange, dataMessage) {
            // A user is calling us or joining an existing call.
            this._stopIfOlderThan(120 * 1000);
            const callMgr = await this._getCallManager(exchange, dataMessage);
            await callMgr.addPeerJoin(this.get('source'), this.get('sourceDevice'), exchange.data);
        },

        _handleCallOfferControl: async function(exchange, dataMessage) {
            // Call offers are peer connection offers.
            this._stopIfOlderThan(120 * 1000);
            const callMgr = await this._getCallManager(exchange, dataMessage);
            callMgr.addPeerOffer(this.get('source'), this.get('sourceDevice'), exchange.data);
        },

        _handleCallAcceptOfferControl: async function(exchange, dataMessage) {
            // A peer accepted our peer connection offer.
            this._stopIfOlderThan(120 * 1000);
            const callMgr = await this._getCallManager(exchange, dataMessage);
            callMgr.addPeerAcceptOffer(this.get('source'), this.get('sourceDevice'), exchange.data);
        },

        _handleCallICECandidatesControl: async function(exchange, dataMessage) {
            this._stopIfOlderThan(120 * 1000);
            const callMgr = await this._getCallManager(exchange);
            callMgr.addPeerICECandidates(this.get('source'), this.get('sourceDevice'), exchange.data);
        },

        _handleCallLeaveControl: async function(exchange, dataMessage) {
            this._stopIfOlderThan(120 * 1000);
            const callMgr = await this._getCallManager(exchange);
            callMgr.addPeerLeave(this.get('source'), this.get('sourceDevice'), exchange.data);
        },

        _handleCallHeartbeatControl: async function(exchange, dataMessage) {
            this._stopIfOlderThan(120 * 1000);
            const callMgr = await this._getCallManager(exchange, dataMessage);
            await callMgr.peerHeartbeat(this.get('source'), this.get('sourceDevice'), exchange.data);
        },

        _handleCloseSessionControl: function(exchange, dataMessage) {
            const data = exchange.data;
            if (data) {
                const addr = `${this.get('source')}.${this.get('sourceDevice')}`;
                if (data.retransmit) {
                    logger.warn("Legacy retransmit property");
                    schedRetransmit(addr, data.retransmit);
                } else if (data.retransmits) {
                    for (const x of data.retransmits) {
                        schedRetransmit(addr, x);
                    }
                }
            }
        },

        _handleReadMarkControl: async function(exchange, dataMessage) {
            const thread = await this.getThread(exchange.threadId);
            if (!thread) {
                return;  // Presumably thread removed.
            }
            if (this.isSelfSource()) {
                if ((thread.get('readLevel') || 0) < exchange.data.readMark) {
                    await thread.save({readLevel: exchange.data.readMark});
                }
                return;
            }
            const readMarks = Object.assign({}, thread.get('readMarks'));
            const mark = readMarks[this.get('source')];
            if (!mark || mark < exchange.data.readMark) {
                readMarks[this.get('source')] = exchange.data.readMark;
                await thread.save({readMarks});
            }
        },

        _handlePendingMessageControl: async function(exchange, dataMessage) {
            if (this.isSelfSource()) {
                logger.warn("pendingMessage control sent to self by device:", this.get('sourceDevice'));
                return;
            }
            const thread = await this.getThread(exchange.threadId);
            if (!thread) {
                return;  // Presumably thread removed.
            }
            thread.trigger('pendingMessage', this.get('source'));
        },

        _handleBeaconControl: async function(exchange, dataMessage) {
            logger.info("Received beacon:", exchange.data);
            const thread = await this.getThread(exchange.threadId, {includeArchived: true});
            if (!thread) {
                logger.warn('Dropping beacon for missing:', exchange.threadId);
                return;
            }
            if (thread.get('blocked') && !this.isSelfSource()) {
                logger.warn("Dropping incoming beacon for blocked: " + thread);
                return;
            }
            const members = await thread.getMembers();
            if (members.indexOf(this.get('source')) === -1) {
                // Add member and send threadUpdate letting everyone (including the beacon source)
                // that they've been placed in the thread.
                logger.warn("Adding beaconing user to thread:", this.get('source'));
                await thread.addMember(this.get('source'));
                await thread.sendUpdate({
                    distribution: {
                        expression: thread.get('distribution')
                    },
                    threadTitle: thread.get('title'),
                });
                const adding = await F.atlas.getContact(this.get('source'));
                await thread.createMessage({
                    type: 'clientOnly',
                    plain: `${adding.getName()} joined the ${thread.get('type')}.`
                });
            }
            if (exchange.data.conversationToken) {
                const convo = await F.atlas.getConversation(exchange.data.conversationToken);
                if (convo) {
                    // Send any messages created since the conversation was started.
                    const created = new Date(convo.created);
                    const messages = new F.MessageCollection([], {thread});
                    await messages.fetchToReceived(created.getTime(), {includeReplies: true});
                    for (const x of messages.filter(x => x.get('type') !== 'clientOnly')) {
                        await thread.resendMessage(x, {addrs: [this.get('source')]});
                    }
                }
            }
        },

        markRead: async function(read, options) {
            options = options || {};
            if (this.get('read')) {
                return;
            }
            read = read || Date.now();
            const updates = {read};
            if (this.get('expiration') && !this.get('expirationStart')) {
                updates.expirationStart = read;
            }
            if (options.save !== false) {
                await this.save(updates, {skipSearchIndexes: true});
            } else {
                this.set(updates);
            }
            const thread = await this.getThread();
            if (thread) {
                if (this.get('timestamp') > thread.get('readLevel') || 0) {
                    await thread.save({readLevel: this.get('timestamp')});
                    thread.scheduleUnreadUpdate();
                }
            }
            if (options.sendSync !== false) {
                scheduleReadSync({
                    sender: this.get('sender'),
                    thread,
                    timestamp: this.get('sent')
                });
            }
            if (F.notifications) {
                F.notifications.remove(this.id);
            }
        },

        markExpired: async function() {
            this.trigger('expired', this);
            const thread = await this.getThread();
            // This can race with thread removal...
            if (thread) {
                thread.trigger('expired', this);
                // Give event handlers time to sing and dance, ugly but works.
                setTimeout(() => this.destroy(), 2000);
            } else {
                this.destroy();
            }
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

        _setToExpire: function() {
            if (this.isExpiring() && !this.expiration) {
                const ms_from_now = this.msTilExpire();
                setTimeout(this.markExpired.bind(this), ms_from_now);
            }
        },

        addDeliveryReceipt: async function(protocolReceipt) {
            return await this.addReceipt('delivery', {
                addr: protocolReceipt.get('source'),
                device: protocolReceipt.get('sourceDevice'),
            });
        },

        addSentReceipt: async function(desc) {
            if (!this._driftCheck) {
                this._driftCheck = true;
                const drift = this.get('timestamp') - desc.serverTimestamp;
                if (Math.abs(drift) > 5000) {
                    logger.warn(`Clock drift detected: ${drift} ms.`);
                    this.set('timestamp', desc.serverTimestamp);
                    if (this.collection) {
                        this.collection.sort();
                    }
                    await this.save();
                }
            }
            return await this.addReceipt('sent', desc);
        },

        addErrorReceipt: async function(desc) {
            return await this.addReceipt('error', this._copyError(desc));
        },

        addReceipt: async function(type, attrs) {
            if (!attrs.timestamp) {
                attrs.timestamp = Date.now();
            }
            const receipt = new F.MessageReceipt(Object.assign({
                messageId: this.id,
                type,
            }, attrs));
            await receipt.save();
            this.receipts.add(receipt);
        },

        fetchAttachmentData: async function(id) {
            const attachment = this.get('attachments').find(x => x.id === id);
            if (!attachment) {
                throw ReferenceError("Attachment Not Found");
            }
            const mr = F.foundation.getMessageReceiver();
            attachment.data = await mr.fetchAttachment(attachment);
            await this.save();
            return attachment.data;
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
            return b.get('timestamp') - a.get('timestamp');
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

        fetchAll: async function(options) {
            await this.fetch(Object.assign({
                reset: true,
                index: {
                    name: 'threadId-timestamp',
                    lower: [this.threadId],
                    upper: [this.threadId, Infinity],
                    order : 'desc'
                }
            }, options));
        },

        fetchByMember: async function(memberId, options) {
            await this.fetch({
                index: {
                    name: 'member',
                    only: memberId
                }
            }, options);
        },

        fetchPage: async function(limit, options) {
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
                const oldest = this.at(this.length - 1);
                upper = oldest.get('timestamp');
                excludeUpper = true;
            }
            await this.fetch({
                remove: false,
                reset,
                limit,
                filter: x => !x.messageRef,
                index: {
                    name  : 'threadId-timestamp',
                    lower : [this.threadId],
                    upper : [this.threadId, upper],
                    excludeUpper,
                    order : 'desc'
                }
            }, options);
        },

        fetchToReceived: async function(received, options) {
            options = options || {};
            let upperReceived;
            let reset;
            if (this.length === 0) {
                // First fetch, use reset for speed.
                upperReceived = Infinity;
                reset = true; // Faster rendering.
            } else {
                // not our first rodeo, fetch only older messages.
                const oldest = this.at(this.length - 1);
                upperReceived = oldest.get('timestamp');
                if (upperReceived <= received) {
                    return;  // Already paged in.
                }
            }
            await this.fetch({
                remove: false,
                reset,
                filter: options.includeReplies ? undefined : x => !x.messageRef,
                index: {
                    name  : 'threadId-timestamp',
                    lower : [this.threadId, received],
                    upper : [this.threadId, upperReceived],
                    order : 'desc'
                }
            }, options);
        },

        fetchNewer: async function(options) {
            /* Only look for messages newer than what's in our collection. Used when remote
             * updates have taken place and we need to refresh. */
            options = options || {};
            if (this.length === 0) {
                logger.warn("fetchNewer used on unloaded collection");
                return await this.fetchPage(null, options);
            }
            const lower = this.at(0).get('timestamp');
            await this.fetch({
                remove: false,
                filter: options.includeReplies ? undefined : x => !x.messageRef,
                index: {
                    name  : 'threadId-timestamp',
                    lower : [this.threadId, lower],
                    upper : [this.threadId, Infinity],
                    excludeLower: true,
                    order : 'desc'
                }
            }, options);
        },

        totalCount: async function() {
            const db = await F.util.idbRequest(indexedDB.open(F.Database.id));
            const t = db.transaction(this.storeName);
            const store = t.objectStore(this.storeName);
            if (this.threadId) {
                const index = store.index('threadId-timestamp');
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
            F.assert(this.message.id);
            await this.fetch({
                index: {
                    name: 'messageId',
                    only: this.message.id
                }
            });
        }
    });


    F.MessageReplyCollection = Backbone.Collection.extend({
        model: F.Message,
        database: F.Database,
        storeName: 'messages',

        initialize: function(models, options) {
            this.message = options.message;
        },

        fetchAll: async function() {
            F.assert(this.message.id);
            await this.fetch({
                index: {
                    name: 'messageRef',
                    only: this.message.id
                }
            });
        }
    });

})();
