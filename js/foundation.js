/*
 * vim: ts=4:sw=4:expandtab
 */

;(function() {
    'use strict';
    window.onInvalidStateError = function(e) {
        console.log(e);
        throw e;
    };

    console.log('foundation page loaded');

    textsecure.startWorker('/js/libsignal-protocol-worker.js');

    var view;
    var SERVER_URL = 'https://textsecure.forsta.services';
    var SERVER_PORTS = [443];
    var ATTACHMENT_SERVER_URL = 'https://forsta-relay.s3.amazonaws.com';
    var messageReceiver;
    window.getSocketStatus = function() {
        if (messageReceiver) {
            return messageReceiver.getStatus();
        } else {
            return -1;
        }
    };
    window.getAccountManager = function() {
        var USERNAME = storage.get('number_id');
        var PASSWORD = storage.get('password');
        var accountManager = new textsecure.AccountManager(
            SERVER_URL, SERVER_PORTS, USERNAME, PASSWORD
        );
        accountManager.addEventListener('registration', function() {
            if (!Whisper.Registration.everDone()) {
                storage.put('safety-numbers-approval', false);
            }
            Whisper.Registration.markDone();
        });
        return accountManager;
    };

    storage.fetch();
    storage.onready(function() {
        window.dispatchEvent(new Event('storage_ready'));
        setUnreadCount(storage.get("unreadCount", 0));
    });

    window.getSyncRequest = function() {
        return new textsecure.SyncRequest(textsecure.messaging, messageReceiver);
    };

    window.initFoundation = function(firstRun) {
        window.removeEventListener('online', initFoundation);
        if (!Whisper.Registration.isDone()) {
            throw "Not Registered!";
        }

        if (messageReceiver) {
            throw "unexpected condition";
            //messageReceiver.close();
        }

        var USERNAME = storage.get('number_id');
        var PASSWORD = storage.get('password');
        var mySignalingKey = storage.get('signaling_key');

        // initialize the socket and start listening for messages
        messageReceiver = new textsecure.MessageReceiver(
            SERVER_URL, SERVER_PORTS, USERNAME, PASSWORD, mySignalingKey, ATTACHMENT_SERVER_URL
        );
        messageReceiver.addEventListener('message', onMessageReceived);
        messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        messageReceiver.addEventListener('contact', onContactReceived);
        messageReceiver.addEventListener('group', onGroupReceived);
        messageReceiver.addEventListener('sent', onSentMessage);
        messageReceiver.addEventListener('read', onReadReceipt);
        messageReceiver.addEventListener('error', onError);

        window.textsecure.messaging = new textsecure.MessageSender(
            SERVER_URL, SERVER_PORTS, USERNAME, PASSWORD, ATTACHMENT_SERVER_URL
        );
        if (firstRun === true && textsecure.storage.user.getDeviceId() != '1') {
            if (!storage.get('theme-setting') && textsecure.storage.get('userAgent') === 'OWI') {
                storage.put('theme-setting', 'ios');
            }
            var syncRequest = new textsecure.SyncRequest(textsecure.messaging, messageReceiver);
            syncRequest.addEventListener('success', function() {
                console.log('sync successful');
                storage.put('synced_at', Date.now());
                window.dispatchEvent(new Event('textsecure:contactsync'));
            });
            syncRequest.addEventListener('timeout', function() {
                console.log('sync timed out');
                window.dispatchEvent(new Event('textsecure:contactsync'));
            });
        }
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
        console.log(e);
        console.log(e.stack);

        if (e.name === 'HTTPError' && (e.code == 401 || e.code == 403)) {
            Whisper.Registration.remove();
            return;
        }

        if (e.name === 'HTTPError' && e.code == -1) {
            // Failed to connect to server
            console.warn("Suspect logic ... ");
            if (navigator.onLine) {
                console.log('retrying in 1 minute');
                setTimeout(initFoundation, 60000);
            } else {
                console.log('offline');
                messageReceiver.close();
                window.addEventListener('online', initFoundation);
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
