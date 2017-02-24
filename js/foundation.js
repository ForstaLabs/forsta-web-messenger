/*
 * vim: ts=4:sw=4:expandtab
 */

;(function() {
    'use strict';
    window.onInvalidStateError = function(e) {
        console.log(e);
        throw e;
    };

    Notification.requestPermission();

    textsecure.startWorker('/js/libsignal-protocol-worker.js');

    var view;
    var server_url = 'https://textsecure.forsta.services';
    var server_ports = [443];
    var attachments_url = 'https://forsta-relay.s3.amazonaws.com';
    var messageReceiver;
    var messageSender;

    window.getSocketStatus = function() {
        if (messageReceiver) {
            return messageReceiver.getStatus();
        } else {
            return -1;
        }
    };

    window.getAccountManager = function() {
        var username = storage.get('number_id');
        var password = storage.get('password');
        var accountManager = new textsecure.AccountManager(server_url,
            server_ports, username, password);
        accountManager.addEventListener('registration', function() {
            if (!Whisper.Registration.everDone()) {
                storage.put('safety-numbers-approval', false);
            }
            Whisper.Registration.markDone();
            window.dispatchEvent(new Event('registration_done'));
        });
        return accountManager;
    };

    storage.fetch();
    storage.onready(function() {
        window.dispatchEvent(new Event('storage_ready'));
        setUnreadCount(storage.get("unreadCount", 0));
    });

    window.getSyncRequest = function() {
        return new textsecure.SyncRequest(messageSender, messageReceiver);
    };

    window.initFoundation = function() {
        if (!Whisper.Registration.isDone()) {
            throw "Not Registered!";
        }
        if (messageReceiver || messageSender) {
            throw new Error("Idempotency violation");
        }

        var username = storage.get('number_id');
        var password = storage.get('password');
        var mySignalingKey = storage.get('signaling_key');

        // initialize the socket and start listening for messages
        messageReceiver = new textsecure.MessageReceiver(server_url,
            server_ports, username, password, mySignalingKey, attachments_url);
        messageReceiver.addEventListener('message', onMessageReceived);
        messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        messageReceiver.addEventListener('contact', onContactReceived);
        messageReceiver.addEventListener('group', onGroupReceived);
        messageReceiver.addEventListener('sent', onSentMessage);
        messageReceiver.addEventListener('read', onReadReceipt);
        messageReceiver.addEventListener('error', onError);

        messageSender = new textsecure.MessageSender(server_url, server_ports,
            username, password, attachments_url);
        textsecure.messaging = messageSender;  // Used externally.
    };

    window.initInstallerFoundation = function() {
        if (!Whisper.Registration.isDone()) {
            throw new Error("Not Registered");
        }

        if (messageReceiver || messageSender) {
            throw new Error("Idempotency violation");
        }

        var username = storage.get('number_id');
        var password = storage.get('password');
        var mySignalingKey = storage.get('signaling_key');

        // initialize the socket and start listening for messages
        messageReceiver = new textsecure.MessageReceiver(server_url,
            server_ports, username, password, mySignalingKey, attachments_url);
        messageReceiver.addEventListener('contact', onContactReceived);
        messageReceiver.addEventListener('group', onGroupReceived);
        messageReceiver.addEventListener('error', onError);

    
        messageSender = new textsecure.MessageSender(server_url, server_ports,
            username, password, attachments_url);
        var syncRequest = new textsecure.SyncRequest(messageSender,
            messageReceiver);
        syncRequest.addEventListener('success', function() {
            console.log('sync successful');
            storage.put('synced_at', Date.now());
            window.dispatchEvent(new Event('textsecure:contactsync'));
        });
        syncRequest.addEventListener('timeout', function() {
            console.log('sync timed out');
            window.dispatchEvent(new Event('textsecure:contactsync'));
        });
    };

    function onContactReceived(ev) {
        var contactDetails = ev.contactDetails;
        ConversationController.create({
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
        var conversation = ConversationController.create(attributes);
        conversation.save();
    }

    function onMessageReceived(ev) {
        var data = ev.data;
        var message = initIncomingMessage(data.source, data.timestamp);
        message.handleDataMessage(data.message);
    }

    function onSentMessage(ev) {
        var now = new Date().getTime();
        var data = ev.data;

        var message = new Whisper.Message({
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

        var message = new Whisper.Message({
            source         : source,
            sent_at        : timestamp,
            received_at    : now,
            conversationId : source,
            type           : 'incoming',
            unread         : 1
        });

        return message;
    }

    function onError(ev) {
        var e = ev.error;
        if (e.name === 'HTTPError' && (e.code == 401 || e.code == 403)) {
            console.warn("Server claims we are not registered!");
            Whisper.Registration.remove();
            window.location.replace('/install.html');
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
                setTimeout(initFoundation, 30000);
            } else {
                console.warn("Waiting for browser to come back online...");
                window.addEventListener('online', initFoundation, {once: true});
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
                ConversationController.findOrCreatePrivateById(message.get('conversationId')).then(function(conversation) {
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
        Whisper.ReadReceipts.add({
            sender    : sender,
            timestamp : timestamp,
            read_at   : read_at
        });
    }

    // lazy hack
    window.receipts = new Backbone.Collection();

    function onDeliveryReceipt(ev) {
        var pushMessage = ev.proto;
        var timestamp = pushMessage.timestamp.toNumber();
        console.log(
            'delivery receipt from',
            pushMessage.source + '.' + pushMessage.sourceDevice,
            timestamp
        );

        Whisper.DeliveryReceipts.add({
            timestamp: timestamp, source: pushMessage.source
        });
    }
})();
