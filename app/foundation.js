/*
 * vim: ts=4:sw=4:expandtab
 */
;(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.foundation = {};

    const server_url = 'https://textsecure.forsta.services';
    const server_port = 443;
    const attachments_url = 'https://forsta-relay.s3.amazonaws.com';
    let messageReceiver;
    let messageSender;

    ns.getMessageReceiver = () => messageReceiver;
    ns.getMessageSender = () => messageSender;

    ns.syncRequest = function() {
        console.assert(messageSender);
        console.assert(messageReceiver);
        return new textsecure.SyncRequest(messageSender, messageReceiver);
    };

    ns.getSocketStatus = function() {
        if (messageReceiver) {
            return messageReceiver.getStatus();
        } else {
            return -1;
        }
    };

    let _accountManager;
    ns.getAccountManager = async function() {

        if (_accountManager) {
            return _accountManager;
        }
        const username = await F.state.get('numberId');
        const password = await F.state.get('password');
        const accountManager = new textsecure.AccountManager(server_url,
            server_port, username, password);
        accountManager.addEventListener('registration', async function() {
            await F.state.put('registered', true);
        });
        _accountManager = accountManager;
        return accountManager;
    };

    ns.makeTextSecureServer = async function() {
        const state = await F.state.getDict(['numberId', 'password',
            'signalingKey', 'number', 'deviceId']);
        return new textsecure.TextSecureServer(server_url, server_port,
            state.numberId, state.password, state.number, state.deviceId,
            attachments_url);
    },

    ns.initApp = async function() {
        if (!await F.state.get('registered')) {
            throw new Error('Not Registered');
        }
        if (messageReceiver || messageSender) {
            throw new Error("Already initialized");
        }
        await textsecure.init(new F.TextSecureStore());
        const ts = await ns.makeTextSecureServer();
        const signalingKey = await F.state.get('signalingKey');
        messageReceiver = new textsecure.MessageReceiver(ts, signalingKey);
        messageReceiver.addEventListener('message', onMessageReceived);
        messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        messageReceiver.addEventListener('contact', onContactReceived);
        messageReceiver.addEventListener('group', onGroupReceived);
        messageReceiver.addEventListener('sent', onSentMessage);
        messageReceiver.addEventListener('read', onReadReceipt);
        messageReceiver.addEventListener('error', onError);
        messageSender = new textsecure.MessageSender(ts);
        textsecure.messaging = messageSender;  // Used externally. XXX
    };

    ns.initInstaller = async function() {
        if (messageReceiver || messageSender) {
            throw new Error("Already initialized");
        }
        await textsecure.init();
        const ts = await ns.makeTextSecureServer();
        const signalingKey = await F.state.get('signalingKey');
        messageReceiver = new textsecure.MessageReceiver(ts, signalingKey);
        messageReceiver.addEventListener('contact', onContactReceived);
        messageReceiver.addEventListener('group', onGroupReceived);
        messageReceiver.addEventListener('error', onError.bind(this, /*retry*/ false));
        messageSender = new textsecure.MessageSender(ts);
    };

    function onContactReceived(ev) {
        var contactDetails = ev.contactDetails;
        F.getConversations().add({
            name: contactDetails.name,
            id: contactDetails.number,
            avatar: contactDetails.avatar,
            color: contactDetails.color,
            type: 'private',
            active_at: Date.now()
        }).save();
    }

    function onGroupReceived(ev) {
        var groupDetails = ev.groupDetails;
        var attributes = {
            id: groupDetails.id,
            name: groupDetails.name,
            members: groupDetails.members,
            avatar: groupDetails.avatar,
            type: 'group',
        };
        if (groupDetails.active) {
            attributes.active_at = Date.now();
        } else {
            attributes.left = true;
        }
        F.getConversations().add(attributes).save();
    }

    function onMessageReceived(ev) {
        var data = ev.data;
        var message = initIncomingMessage(data.source, data.timestamp);
        message.handleDataMessage(data.message);
    }

    function onSentMessage(ev) {
        var now = new Date().getTime();
        var data = ev.data;

        var message = new F.Message({
            source         : textsecure.storage.user.getNumber(),
            sent_at        : data.timestamp,
            received_at    : now,
            conversationId : data.destination,
            type           : 'outgoing',
            sent           : true,
            expirationStartTimestamp: data.expirationStartTimestamp,
        });

        message.handleDataMessage(data.message);
    }

    function initIncomingMessage(source, timestamp) {
        var now = new Date().getTime();

        var message = new F.Message({
            source         : source,
            sent_at        : timestamp,
            received_at    : now,
            conversationId : source,
            type           : 'incoming',
            unread         : 1
        });

        return message;
    }

    async function onError(ev) {
        var e = ev.error;
        if (e.name === 'HTTPError' && (e.code == 401 || e.code == 403)) {
            console.warn("Server claims we are not registered!");
            await F.state.put('registered', false);
            location.replace(F.urls.install);
            return;
        }

        if (e.name === 'HTTPError' && e.code == -1) {
            // Failed to connect to server
            console.warn("Connection Problem");
            messageReceiver.close();
            messageReceiver = null;
            messageSender = null;
            if (navigator.onLine) {
                console.info('Retrying in 30 seconds...');
                setTimeout(ns.initApp, 30000);
            } else {
                console.warn("Waiting for browser to come back online...");
                addEventListener('online', ns.initApp, {once: true});
            }
            return;
        }

        if (ev.proto) {
            if (e.name === 'MessageCounterError') {
                // Ignore this message. It is likely a duplicate delivery
                // because the server lost our ack the first time.
                return;
            }
            var envelope = ev.proto;
            var message = initIncomingMessage(envelope.source, envelope.timestamp.toNumber());
            message.saveErrors(e).then(function() {
                const conversations = F.getConversations();
                conversations.findOrCreatePrivateById(message.get('conversationId')).then(function(conversation) {
                    conversation.set({
                        active_at: Date.now(),
                        unreadCount: conversation.get('unreadCount') + 1
                    });

                    var conversation_timestamp = conversation.get('timestamp');
                    var message_timestamp = message.get('timestamp');
                    if (!conversation_timestamp || message_timestamp > conversation_timestamp) {
                        conversation.set({ timestamp: message.get('sent_at') });
                    }
                    conversation.save();
                    conversation.trigger('newmessage', message);
                    conversation.notify(message);
                });
            });
            return;
        }

        throw e;
    }

    function onReadReceipt(ev) {
        var read_at   = ev.timestamp;
        var timestamp = ev.read.timestamp;
        var sender    = ev.read.sender;
        console.log('read receipt ', sender, timestamp);
        F.ReadReceipts.add({
            sender    : sender,
            timestamp : timestamp,
            read_at   : read_at
        });
    }

    function onDeliveryReceipt(ev) {
        var pushMessage = ev.proto;
        var timestamp = pushMessage.timestamp.toNumber();
        console.log(
            'delivery receipt from',
            pushMessage.source + '.' + pushMessage.sourceDevice,
            timestamp
        );

        F.DeliveryReceipts.add({
            timestamp: timestamp, source: pushMessage.source
        });
    }
})();
