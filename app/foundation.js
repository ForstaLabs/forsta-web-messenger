// vim: ts=4:sw=4:expandtab

(function() {
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

    let _conversations;
    ns.getConversations = function() {
        if (!_conversations) {
            _conversations = new F.ConversationCollection();
        }
        return _conversations;
    };

    let _users;
    ns.getUsers = function() {
        if (!_users) {
            _users = new F.UserCollection();
        }
        return _users;
    };

    let _tags;
    ns.getTags = function() {
        if (!_tags) {
            _tags = new F.TagCollection();
        }
        return _tags;
    };

    let _accountManager;
    ns.getAccountManager = async function() {
        if (_accountManager) {
            return _accountManager;
        }
        const username = await F.state.get('addrId');
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
        const state = await F.state.getDict(['addrId', 'password',
            'signalingKey', 'addr', 'deviceId']);
        return new textsecure.TextSecureServer(server_url, server_port,
            state.addrId, state.password, state.addr, state.deviceId,
            attachments_url);
    };

    ns.fetchData = async function() {
        await Promise.all([
            F.foundation.getUsers().fetch(),
            F.foundation.getTags().fetch(),
            textsecure.init(new F.TextSecureStore())
        ]);
    };

    ns.initApp = async function() {
        if (!(await F.state.get('registered'))) {
            throw new Error('Not Registered');
        }
        if (messageReceiver || messageSender) {
            throw new Error("Already initialized");
        }
        await this.fetchData();
        const ts = await ns.makeTextSecureServer();
        const signalingKey = await F.state.get('signalingKey');
        messageReceiver = new textsecure.MessageReceiver(ts, signalingKey);
        messageReceiver.addEventListener('message', onMessageReceived);
        messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        messageReceiver.addEventListener('contact', onContactReceived);
        messageReceiver.addEventListener('group', onGroupReceived);
        messageReceiver.addEventListener('sent', onSentMessage.bind(null, ts.addr));
        messageReceiver.addEventListener('read', onReadReceipt);
        messageReceiver.addEventListener('error', onError);
        messageSender = new textsecure.MessageSender(ts);
    };

    ns.initInstaller = async function() {
        if (messageReceiver || messageSender) {
            throw new Error("Already initialized");
        }
        await this.fetchData();
        const ts = await ns.makeTextSecureServer();
        const signalingKey = await F.state.get('signalingKey');
        messageReceiver = new textsecure.MessageReceiver(ts, signalingKey);
        messageReceiver.addEventListener('contact', onContactReceived);
        messageReceiver.addEventListener('group', onGroupReceived);
        messageReceiver.addEventListener('error', onError.bind(this, /*retry*/ false));
        messageSender = new textsecure.MessageSender(ts);
    };

    async function onContactReceived(ev) {
        const contactDetails = ev.contactDetails;
        console.warn("Ignoring contact message", contactDetails);
        return;
        /*await ns.getConversations().add({
            name: contactDetails.name,
            id: contactDetails.addr,
            avatar: contactDetails.avatar,
            color: contactDetails.color,
            type: 'private',
            active_at: Date.now()
        }).save();*/
    }

    async function onGroupReceived(ev) {
        const groupDetails = ev.groupDetails;
        const attributes = {
            id: groupDetails.id,
            name: groupDetails.name,
            recipients: groupDetails.members,
            avatar: groupDetails.avatar,
            type: 'group',
        };
        if (groupDetails.active) {
            attributes.active_at = Date.now();
        } else {
            attributes.left = true;
        }
        await ns.getConversations().makeNew(attributes);
    }

    async function onMessageReceived(ev) {
        const data = ev.data;
        const message = initIncomingMessage(data.source, data.timestamp);
        await message.handleDataMessage(data.message);
    }

    async function onSentMessage(addr, ev) {
        const data = ev.data;
        console.warn('XXX Not putting bullshit converstationID on send messag ', data.destination);
        const message = new F.Message({
            source: addr,
            sent_at: data.timestamp,
            received_at: new Date().getTime(),
            //conversationId: data.destination,
            type: 'outgoing',
            sent: true,
            expirationStartTimestamp: data.expirationStartTimestamp,
        });
        await message.handleDataMessage(data.message);
    }

    function initIncomingMessage(addr, timestamp) {
        console.warn("Not including fake convo id based on source addr! CHECK THIS FOR full cycle working XXX!", addr);
        return new F.Message({
            source: addr,
            sent_at: timestamp,
            received_at: new Date().getTime(),
            // conversationId: source, // XXX
            type: 'incoming',
            unread: 1
        });
    }

    async function onError(ev) {
        const error = ev.error;
        if (error.name === 'HTTPError' && (error.code == 401 || error.code == 403)) {
            console.warn("Server claims we are not registered!");
            await F.state.put('registered', false);
            location.replace(F.urls.install);
        } else if (error.name === 'HTTPError' && error.code == -1) {
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
        } else if (ev.proto) {
            if (error.name === 'MessageCounterError') {
                // Ignore this message. It is likely a duplicate delivery
                // because the server lost our ack the first time.
                return;
            }
            const message = initIncomingMessage(ev.proto.source,
                                                ev.proto.timestamp.toNumber());
            await message.saveErrors(error);
            const convo = await ns.getConversations().findOrCreate(message);
            convo.set({
                active_at: Date.now(),
                unreadCount: convo.get('unreadCount') + 1
            });
            const cts = convo.get('timestamp');
            const mts = message.get('timestamp');
            if (!cts || mts > cts) {
                convo.set({timestamp: message.get('sent_at')});
            }
            await convo.save();
            convo.trigger('newmessage', message);
            convo.notify(message);
        } else {
            throw error;
        }
    }

    function onReadReceipt(ev) {
        var read_at = ev.timestamp;
        var timestamp = ev.read.timestamp;
        var sender = ev.read.sender;
        // XXX Not saving??
        F.ReadReceipts.add({
            sender    : sender,
            timestamp : timestamp,
            read_at   : read_at
        });
    }

    function onDeliveryReceipt(ev) {
        var pushMessage = ev.proto;
        var timestamp = pushMessage.timestamp.toNumber();
        // XXX Not saving??
        F.DeliveryReceipts.add({
            timestamp: timestamp, source: pushMessage.source
        });
    }
})();
