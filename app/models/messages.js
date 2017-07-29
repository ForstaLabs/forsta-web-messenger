/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    function makeInvalidUser(addr) {
        return new F.User({
            id: 'INVALID-' + addr,
            first_name: 'Invalid User',
            last_name: `(${addr})`,
            phone: addr,
            email: 'support@forsta.io'
        });
    }

    F.Message = Backbone.Model.extend({
        database: F.Database,
        storeName: 'messages',

        initialize: function() {
            this.conversations = F.foundation.getConversations();
            this.on('change:attachments', this.updateImageUrl);
            this.on('destroy', this.revokeImageUrl);
            this.on('change:expirationStartTimestamp', this.setToExpire);
            this.on('change:expireTimer', this.setToExpire);
            this.setToExpire();
        },

        defaults: function() {
            return {
                timestamp: Date.now(),
                attachments: [],
                deliveryReceipts: []
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
                     * rerender every message on every convo view. */
                    attrs.safe_html = F.emoji.replace_unified(F.util.htmlSanitize(attrs.html));
                }
                delete attrs.html;
            }
            return Backbone.Model.prototype.set.call(this, attrs, options);
        },

        validate: function(attrs, options) {
            const required = [
                'conversationId',
                'received_at',
                'sent_at'
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

        isExpirationTimerUpdate: function() {
            const expire = textsecure.protobuf.DataMessage.Flags.EXPIRATION_TIMER_UPDATE;
            return !!(this.get('flags') & expire);
        },

        isGroupUpdate: function() {
            return !!(this.get('group_update'));
        },

        isIncoming: function() {
            return this.get('type') === 'incoming';
        },

        isClientOnly: function() {
            return this.get('type') === 'clientOnly';
        },

        isUnread: function() {
            return !!this.get('unread');
        },

        getMeta: function() {
            const meta = [];
            if (this.isGroupUpdate()) {
                const group_update = this.get('group_update');
                if (group_update.left) {
                    const left = group_update.left.map(this.getUserByAddr.bind(this));
                    meta.push(left.map(u => u.getName()).join(', ') + ' left the conversation');
                }
                if (group_update.name) {
                    meta.push(`Conversation title changed to "${group_update.name}"`);
                }
                if (group_update.joined) {
                    const joined = group_update.joined.map(this.getUserByAddr.bind(this));
                    meta.push(joined.map(u => u.getName()).join(', ') + ' joined the conversation');
                }
            }
            if (this.isEndSession()) {
                meta.push('Secure session reset');
            }
            if (this.isIncoming() && this.hasKeyConflicts()) {
                meta.push('Received message with unknown identity key');
            }
            if (this.isExpirationTimerUpdate()) {
                const t = this.get('expirationTimerUpdate').expireTimer;
                if (t) {
                    const human_time = F.tpl.help.humantime(t);
                    meta.push(`Message expiration set to ${human_time}`);
                } else {
                    meta.push('Message expiration turned off');
                }
            }
            if (this.get('type') === 'keychange') {
                // XXX might be double coverage with hasKeyConflicts...
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

        getConversation: function() {
            const id = this.get('conversationId');
            console.assert(id);
            return this.conversations.get(id);
        },

        getConversationMessage: function() {
            /* Return this same message but from the active conversation collection.  Note that
             * it's entirely possible if not likely that this returns self or undefined. */
            return this.getConversation().messages.get(this.id);
        },

        getSender: function() {
            return F.foundation.getUsers().get(this.get('sender'));
        },

        getUserByAddr: function(addr) {
            const users = F.foundation.getUsers();
            return users.findWhere({phone: addr}); // XXX phone is not stable!
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

        send: async function(promise) {
            this.trigger('pending');
            let sent;
            let content;
            try {
                content = (await promise).content;
                sent = true;
            } catch(e) {
                if (e instanceof Error) {
                    await this.saveErrors(e);
                } else {
                    await this.saveErrors(e.errors);
                    sent = e.successfulAddrs.length > 0;
                    content = e.content;
                }
            } finally {
                this.trigger('done');
                await this.save({sent, expirationStartTimestamp: Date.now()});
                await F.queueAsync('message-send-sync-' + this.id,
                                   this._sendSyncMessage.bind(this, content));
            }
        },

        _sendSyncMessage: async function(content) {
            /* Do not run directly, use queueAsync. */
            console.assert(!this.get('synced'));
            console.assert(content);
            return await F.foundation.getMessageSender().sendSyncMessage(content,
                this.get('sent_at'), this.get('destination'),
                this.get('expirationStartTimestamp'));
        },

        saveErrors: async function(errors) {
            if (!(errors instanceof Array)) {
                errors = [errors];
            }
            errors = errors.map(e => {
                console.assert(e instanceof Error);
                /* Serialize the error for storage to the DB. */
                console.warn('Saving Message Error:', e);
                const obj = _.pick(e, 'name', 'message', 'code', 'addr',
                                   'reason', 'functionCode', 'args', 'stack');
                return obj;
            });
            errors = errors.concat(this.get('errors') || []);
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
                    this.saveErrors(e);
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

        handleDataMessage: async function(dataMessage) {
            return await F.queueAsync('message-handle-data-init',
                                      this._handleDataMessage.bind(this, dataMessage));
        },

        _handleDataMessage: async function(dataMessage) {
            const source = this.get('source');
            const incoming = this.get('type') === 'incoming';
            const peer = incoming ? source : this.get('destination');
            const exchange = dataMessage.body ? this.parseExchange(dataMessage.body) : {};
            const group = dataMessage.group;
            let conversation;
            const cid = (group && group.id) || exchange.threadId;

            if (cid) {
                conversation = this.conversations.get(cid);
            } else {
                // Possibly throw here once clients are playing nice.
                console.error("Message did not provide group.id or threadId.");
            }
            if (!conversation) {
                if (group) {
                    if (cid) {
                        console.info("Creating new group conversation:", cid);
                        conversation = await this.conversations.make({
                            id: cid,
                            name: exchange.threadTitle || group.name,
                            recipients: group.members
                        });
                    } else {
                        console.error("Incoming group conversation without group update");
                        conversation = await this.conversations.make({
                            name: 'CORRUPT 1 ' + (exchange.threadTitle || group.name),
                            recipients: group.members
                        });
                    }
                } else {
                    const matches = this.conversations.filter(x => {
                        const r = x.get('recipients');
                        return r.length === 1 && r[0] === peer;
                    });
                    if (matches.length) {
                        conversation = matches[0];
                        if (cid) {
                            console.warn("Migrating to new conversation ID:", conversation.id, '=>', cid);
                            const savedMessages = new F.MessageCollection([], {conversation});
                            await savedMessages.fetchAll();
                            await Promise.all(savedMessages.map(m => m.save({conversationId: cid})));
                            /* Update the message collection of the convo too */
                            for (const m of conversation.messages.models) {
                                m.set('conversationId', cid);
                            }
                            const old = conversation.clone();
                            await conversation.save({id: cid});
                            await old.destroy();
                        }
                    } else {
                        let user = F.foundation.getUsers().findWhere({phone: peer});
                        if (!user) {
                            console.error("Invalid user for addr:", peer);
                            user = makeInvalidUser(peer);
                        }
                        console.info("Creating new private convo with:", user.getName());
                        conversation = await this.conversations.make({
                            id: cid, // Can be falsy, which creates a new one.
                            name: user.getName(),
                            recipients: [peer],
                            users: [user.id]
                        });
                    }
                }
            }

            this.set({
                id: exchange.messageId,
                sender: exchange.sender ? exchange.sender.userId : this.getUserByAddr(source).id,
                userAgent: exchange.userAgent,
                plain: exchange.getText && exchange.getText('plain'),
                html: exchange.getText && exchange.getText('html'),
                conversationId: conversation.id,
                attachments: this.parseAttachments(exchange, dataMessage.attachments),
                decrypted_at: Date.now(),
                flags: dataMessage.flags,
                errors: [],
            });

            F.queueAsync('message-handle-data-' + conversation.id, async function() {
                const convo_updates = {
                    distribution: exchange.distribution
                };
                if (group) {
                    let group_update;
                    if (group.type === textsecure.protobuf.GroupContext.Type.UPDATE) {
                        if (!group.members || !group.members.length) {
                            throw new Error("Invalid assertion about group membership"); // XXX
                        }
                        const members = new F.util.ESet(group.members);
                        members.delete(await F.state.get('addr'));
                        Object.assign(convo_updates, {
                            name: group.name,
                            avatar: group.avatar,
                            recipients: Array.from(members)
                        });
                        const oldMembers = new F.util.ESet(conversation.get('recipients'));
                        const joined = members.difference(oldMembers);
                        const left = oldMembers.difference(members);
                        group_update = conversation.changedAttributes(_.pick(group, 'name', 'avatar')) || {};
                        if (joined.size) {
                            group_update.joined = Array.from(joined);
                        }
                        if (left.size) {
                            group_update.left = Array.from(left);
                        }
                    } else if (group.type === textsecure.protobuf.GroupContext.Type.QUIT) {
                        group_update = {left: [source]};
                        convo_updates.recipients = _.without(conversation.get('recipients'), source);
                    }
                    if (group_update) {
                        this.set({group_update});
                    }
                }
                if (!incoming) {
                    for (const x of F.deliveryReceiptQueue.drain(this)) {
                        await this.addDeliveryReceipt(x, /*save*/ false);
                    }
                } else {
                    if (F.readReceiptQueue.drain(this).length) {
                        await this.markRead(null, /*save*/ false);
                    } else {
                        convo_updates.unreadCount = conversation.get('unreadCount') + 1;
                    }
                }
                if (this.isExpirationTimerUpdate()) {
                    this.set('expirationTimerUpdate', {
                        source,
                        expireTimer: dataMessage.expireTimer
                    });
                    conversation.set('expireTimer', dataMessage.expireTimer);
                } else if (dataMessage.expireTimer) {
                    this.set('expireTimer', dataMessage.expireTimer);
                }
                if (!this.isEndSession()) {
                    if (dataMessage.expireTimer) {
                        if (dataMessage.expireTimer !== conversation.get('expireTimer')) {
                          conversation.addExpirationTimerUpdate(
                              dataMessage.expireTimer, source,
                              this.get('received_at'));
                        }
                    } else if (conversation.get('expireTimer')) {
                        conversation.addExpirationTimerUpdate(0, source,
                            this.get('received_at'));
                    }
                }
                convo_updates.timestamp = Math.max(conversation.get('timestamp') || 0,
                                                                    this.get('sent_at'));
                convo_updates.lastMessage = this.getNotificationText();
                await Promise.all([this.save(), conversation.save(convo_updates)]);
                conversation.addMessage(this);
            }.bind(this));
        },

        markRead: async function(read_at, save) {
            if (!this.get('unread')) {
                console.warn("Already marked as read.  nothing to do.", this);
                return;
            }
            this.unset('unread');
            if (this.get('expireTimer') && !this.get('expirationStartTimestamp')) {
                this.set('expirationStartTimestamp', read_at || Date.now());
            }
            F.notifications.remove(F.notifications.where({
                messageId: this.id
            }));
            if (save !== false) {
                await this.save();
            }
            this.getConversation().trigger('read');
        },

        markExpired: async function() {
            this.trigger('expired', this);
            this.getConversation().trigger('expired', this);
            this.destroy();
        },

        isExpiring: function() {
            return this.get('expireTimer') && this.get('expirationStartTimestamp');
        },

        msTilExpire: function() {
              if (!this.isExpiring()) {
                return Infinity;
              }
              var now = Date.now();
              var start = this.get('expirationStartTimestamp');
              var delta = this.get('expireTimer') * 1000;
              var ms_from_now = start + delta - now;
              if (ms_from_now < 0) {
                  ms_from_now = 0;
              }
              return ms_from_now;
        },

        setToExpire: function() {
            if (this.isExpiring() && !this.expireTimer) {
                var ms_from_now = this.msTilExpire();
                setTimeout(this.markExpired.bind(this), ms_from_now);
            }
        },

        addDeliveryReceipt: async function(receipt, save) {
            const deliveryReceipts = Array.from(this.get('deliveryReceipts')); // try without array copy ?XXX
            deliveryReceipts.push(receipt.get('source') + '.' + receipt.get('sourceDevice'));
            this.set({deliveryReceipts});
            if (save !== false) {
                await this.save();
            }
            /* If this message is not the one wired to our conversation view, update them too. */
            const convoMsg = this.getConversationMessage();
            if (convoMsg && convoMsg.cid !== this.cid) {
                await convoMsg.fetch();
            }
        }
    });

    F.MessageCollection = Backbone.Collection.extend({
        model: F.Message,
        database: F.Database,
        storeName: 'messages',
        comparator: x => -x.get('received_at'),

        initialize: function(models, options) {
            if (options) {
                this.conversation = options.conversation;
            }
        },

        destroyAll: async function () {
            // Must use copy of collection.models to avoid in-place mutation bugs
            // during model.destroy.
            const models = Array.from(this.models);
            await Promise.all(models.map(m => m.destroy()));
        },

        fetchSentAt: async function(timestamp) {
            await this.fetch({
                index: {
                    // 'receipt' index on sent_at
                    name: 'receipt',
                    only: timestamp
                }
            });
        },

        fetchAll: async function() {
            await this.fetch({
                index: {
                    name  : 'conversation',
                    lower : [this.conversation.id],
                    upper : [this.conversation.id, Number.MAX_VALUE],
                }
            });
        },

        fetchPage: async function(limit) {
            if (typeof limit !== 'number') {
                limit = 40;
            }
            const cid = this.conversation.id;
            let upper;
            let reset;
            if (this.length === 0) {
                // fetch the most recent messages first
                upper = Number.MAX_VALUE;
                reset = true; // Faster rendering.
            } else {
                // not our first rodeo, fetch older messages.
                upper = this.at(this.length - 1).get('received_at');
            }
            await this.fetch({
                remove: false,
                reset,
                limit,
                index: {
                    name  : 'conversation',
                    lower : [cid],
                    upper : [cid, upper],
                    order : 'desc'
                }
            });
        },

        hasKeyConflicts: function() {
            return this.any(m => m.hasKeyConflicts());
        }
    });
})();
