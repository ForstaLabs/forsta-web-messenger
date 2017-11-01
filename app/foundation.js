// vim: ts=4:sw=4:expandtab
/* global relay platform */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.foundation = {};

    const server_url = F.env.TEXTSECURE_URL;
    const dataRefreshThreshold = 300;


    async function refreshDataBackgroundTask() {
        const active_refresh = 120;
        let _lastActivity = Date.now();
        function onActivity() {
            /* The visibility API fails us when the user is simply idle but the page
             * is active (at least for linux/chrome). Monitor basic user activity on
             * the page so we can relax our refresh as they idle out. */
            _lastActivity = Date.now();
        }
        document.addEventListener('keydown', onActivity);
        document.addEventListener('mousemove', onActivity);
        while (active_refresh) {
            const idle_refresh = (Date.now() - _lastActivity) / 1000;
            const jitter = Math.random() * 0.40 + .80;
            await relay.util.sleep(jitter * Math.max(active_refresh, idle_refresh));
            console.info("Refreshing foundation data in background");
            try {
                await maybeRefreshData(/*force*/ true);
            } catch(e) {
                console.error("Failed to refresh foundation data:", e);
            }
        }
    }

    let _messageReceiver;
    ns.getMessageReceiver = () => _messageReceiver;

    let _messageSender;
    ns.getMessageSender = () => _messageSender;

    let _threads;
    ns.getThreads = function() {
        if (!_threads) {
            _threads = new F.ThreadCollection();
        }
        return _threads;
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
        const tss = await ns.makeTextSecureServer();
        const accountManager = new relay.AccountManager(tss);
        accountManager.addEventListener('registration', async function() {
            await F.state.put('registered', true);
        });
        _accountManager = accountManager;
        return accountManager;
    };

    ns.makeTextSecureServer = async function() {
        const username = await F.state.get('username');
        const password = await F.state.get('password');
        return new relay.TextSecureServer(server_url, username, password);
    };

    ns.fetchData = async function() {
        await Promise.all([
            ns.getUsers().fetch(),
            ns.getTags().fetch()
        ]);
    };

    ns.generateDeviceName = function() {
        const machine = platform.product || platform.os.family;
        const name = `${F.product} (${platform.name} on ${machine})`;
        if (name.length >= 50) {
            return name.substring(0, 45) + '...)';
        } else {
            return name;
        }
    };

    let _initRelay;
    ns.initRelay = async function() {
        const store = new F.RelayStore();
        const protoPath = F.urls.static + 'protos/';
        const protoQuery = `?v=${F.env.GIT_COMMIT.substring(0, 8)}`;
        await relay.init(store, protoPath, protoQuery);
        _initRelay = true;
    };

    ns.initApp = async function() {
        console.assert(_initRelay);
        if (!(await F.state.get('registered'))) {
            throw new Error('Not Registered');
        }
        if (_messageReceiver || _messageSender) {
            throw new TypeError("Already initialized");
        }
        const tss = await ns.makeTextSecureServer();
        const signalingKey = await F.state.get('signalingKey');
        const addr = await F.state.get('addr');
        const deviceId = await F.state.get('deviceId');
        _messageSender = new relay.MessageSender(tss, addr);
        _messageReceiver = new relay.MessageReceiver(tss, addr, deviceId, signalingKey);
        F.currentDevice = await F.state.get('deviceId');
        await ns.fetchData();
        await ns.getThreads().fetchOrdered();
        _messageSender.addEventListener('keychange', onKeyChange);
        _messageSender.addEventListener('error', onSendError);
        _messageReceiver.addEventListener('message', onMessageReceived);
        _messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        _messageReceiver.addEventListener('keychange', onKeyChange);
        _messageReceiver.addEventListener('sent', onSentMessage);
        _messageReceiver.addEventListener('read', onReadReceipt);
        _messageReceiver.addEventListener('error', onRecvError);
        await _messageReceiver.connect();
        refreshDataBackgroundTask();
    };

    ns.initServiceWorker = async function() {
        console.assert(_initRelay);
        if (!(await F.state.get('registered'))) {
            throw new Error('Not Registered');
        }
        if (_messageReceiver) {
            throw new TypeError("Already initialized");
        }
        const tss = await ns.makeTextSecureServer();
        const signalingKey = await F.state.get('signalingKey');
        const addr = await F.state.get('addr');
        const deviceId = await F.state.get('deviceId');
        _messageSender = new relay.MessageSender(tss, addr);
        _messageReceiver = new relay.MessageReceiver(tss, addr, deviceId, signalingKey,
                                                     /*noWebSocket*/ true);
        F.currentDevice = await F.state.get('deviceId');
        await ns.fetchData();
        await ns.getThreads().fetchOrdered();
        _messageSender.addEventListener('keychange', onKeyChange);
        _messageSender.addEventListener('error', onSendError);
        _messageReceiver.addEventListener('message', onMessageReceived);
        _messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        _messageReceiver.addEventListener('keychange', onKeyChange);
        _messageReceiver.addEventListener('sent', onSentMessage);
        _messageReceiver.addEventListener('read', onReadReceipt);
        _messageReceiver.addEventListener('error', onRecvError);
    };

    ns.autoProvision = async function() {
        console.assert(_initRelay);
        async function fwdUrl(url) {
            url = decodeURIComponent(url);
            await relay.ccsm.fetchResource('/v1/provision/request', {
                method: 'POST',
                json: {
                    uuid: url.match(/[?&]uuid=([^&]*)/)[1],
                    key: url.match(/[?&]pub_key=([^&]*)/)[1]
                }
            });
        }
        function confirmAddr(addr) {
            if (addr !== F.currentUser.id) {
                throw new Error("Foreign account sent us an identity key!");
            }
        }
        const am = await ns.getAccountManager();
        const name = F.foundation.generateDeviceName();
        return await am.registerDevice(name, fwdUrl, confirmAddr);
    };

    let _lastDataRefresh = Date.now();
    async function maybeRefreshData(force) {
        /* If we've been idle for long, refresh data stores. */
        const now = Date.now();
        const elapsed = (now - _lastDataRefresh) / 1000;
        if (force || elapsed > dataRefreshThreshold) {
            _lastDataRefresh = now;
            await ns.fetchData();
        }
    }

    async function onMessageReceived(ev) {
        await maybeRefreshData();
        const data = ev.data;
        const message = new F.Message({
            sender: data.source,
            senderDevice: data.sourceDevice,
            sent: data.timestamp,
            read: 0,  // unread
            received: Date.now(),
            incoming: true,
            expiration: data.message.expireTimer,
            keyChange: data.keyChange,
            flags: data.message.flags
        });
        console.info("Received message:", JSON.stringify(message));
        await message.handleDataMessage(data.message);
    }

    async function onKeyChange(ev) {
        console.warn("Auto-accepting new identity key for:", ev.addr);
        await relay.store.removeIdentityKey(ev.addr);
        await relay.store.saveIdentity(ev.addr, ev.identityKey);
        ev.accepted = true;
    }

    async function onSentMessage(ev) {
        await maybeRefreshData();
        const data = ev.data;
        // NOTE: data.destination is likely the threadId but it's not consistently
        // applied, so we simply drop it here.
        const message = new F.Message({
            sender: data.source,
            senderDevice: data.sourceDevice,
            sent: data.timestamp,
            read: data.timestamp,
            received: Date.now(),
            expiration: data.message.expireTimer,
            expirationStart: data.expirationStartTimestamp || data.timestamp,
            flags: data.message.flags
        });
        console.info("Received sent message from self:", JSON.stringify(message));
        await message.handleDataMessage(data.message);
    }

    async function onRecvError(ev) {
        const error = ev.error;
        if (error instanceof relay.ProtocolError &&
            (error.code === 401 || error.code === 403)) {
            console.error("Recv Auth Error");
            await F.util.resetRegistration();  // reloads page
        } else if (ev.proto) {
            F.util.reportError('Protocol Error', {error});
        } else {
            F.util.reportError('Message Receiver Error', {error});
        }
    }

    async function onSendError(ev) {
        const error = ev.error;
        if (error.code === 401 || error.code === 403) {
            console.error("Send Auth Error");
            await F.util.resetRegistration();  // reloads page
        } else if (ev.proto) {
            F.util.reportError('Protocol Error', {error});
        } else {
            F.util.reportError('Message Sender Error', {error});
        }
    }

    async function onReadReceipt(ev) {
        await maybeRefreshData();
        F.readReceiptQueue.add({
            sent: ev.read.timestamp,
            sender: ev.read.sender,
            senderDevice: ev.read.sourceDevice,
            read: ev.timestamp
        });
    }

    async function onDeliveryReceipt(ev) {
        await maybeRefreshData();
        const sync = ev.proto;
        F.deliveryReceiptQueue.add({
            sent: sync.timestamp,
            sender: sync.source,
            senderDevice: sync.sourceDevice
        });
    }
})();
