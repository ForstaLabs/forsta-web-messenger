// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.foundation = {};

    const server_url = forsta_env.TEXTSECURE_URL;
    const attachments_url = forsta_env.ATTACHMENTS_S3_URL;
    const dataRefreshThreshold = 300;

    let _messageReceiver;
    ns.getMessageReceiver = () => _messageReceiver;

    let _messageSender;
    ns.getMessageSender = () => _messageSender;

    ns.getSocketStatus = function() {
        if (_messageReceiver) {
            return _messageReceiver.getStatus();
        } else {
            return -1;
        }
    };

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
        const username = await F.state.get('username');
        const password = await F.state.get('password');
        const accountManager = new textsecure.AccountManager(server_url, username, password);
        accountManager.addEventListener('registration', async function() {
            await F.state.put('registered', true);
        });
        _accountManager = accountManager;
        return accountManager;
    };

    ns.makeTextSecureServer = async function() {
        const state = await F.state.getDict(['username', 'password',
            'signalingKey', 'addr', 'deviceId']);
        return new textsecure.TextSecureServer(server_url, state.username, state.password,
            state.addr, state.deviceId, attachments_url);
    };

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
            await F.util.sleep(jitter * Math.max(active_refresh, idle_refresh));
            console.info("Refreshing foundation data in background");
            try {
                await maybeRefreshData(/*force*/ true);
            } catch(e) {
                console.error("Failed to refresh foundation data:", e);
            }
        }
    }

    ns.fetchData = async function() {
        await Promise.all([
            ns.getUsers().fetch(),
            ns.getTags().fetch()
        ]);
    };

    ns.initApp = async function() {
        if (!(await F.state.get('registered'))) {
            throw new Error('Not Registered');
        }
        if (_messageReceiver || _messageSender) {
            throw new Error("Already initialized");
        }
        await textsecure.init(new F.TextSecureStore());
        const ts = await ns.makeTextSecureServer();
        const signalingKey = await F.state.get('signalingKey');
        _messageSender = new textsecure.MessageSender(ts);
        _messageReceiver = new textsecure.MessageReceiver(ts, signalingKey);
        await ns.fetchData();
        await ns.getThreads().fetchOrdered();
        _messageReceiver.addEventListener('message', onMessageReceived);
        _messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        _messageReceiver.addEventListener('sent', onSentMessage);
        _messageReceiver.addEventListener('read', onReadReceipt);
        _messageReceiver.addEventListener('error', onError);
        refreshDataBackgroundTask();
    };

    ns.initInstaller = async function() {
        if (_messageReceiver || _messageSender) {
            throw new Error("Already initialized");
        }
        await textsecure.init(new F.TextSecureStore());
        const ts = await ns.makeTextSecureServer();
        const signalingKey = await F.state.get('signalingKey');
        _messageSender = new textsecure.MessageSender(ts);
        _messageReceiver = new textsecure.MessageReceiver(ts, signalingKey);
        await ns.fetchData();
        _messageReceiver.addEventListener('error', onError.bind(null, /*retry*/ false));
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
            source: data.source,
            sourceDevice: data.sourceDevice,
            sent: data.timestamp,
            read: -1,  // unread
            received: Date.now(),
            incoming: true,
            expiration: data.message.expireTimer,
            expirationStart: data.message.expirationStartTimestamp
        });
        await message.handleDataMessage(data.message);
    }

    async function onSentMessage(ev) {
        await maybeRefreshData();
        const data = ev.data;
        // NOTE: data.destination is likely the threadId but it's not consistently
        // applied, so we simply drop it here.
        const message = new F.Message({
            source: data.source,
            sourceDevice: data.sourceDevice,
            sent: data.timestamp,
            read: data.timestamp,
            received: Date.now(),
            expiration: data.message.expireTimer,
            expirationStart: data.message.expirationStartTimestamp,
        });
        await message.handleDataMessage(data.message);
    }

    async function onError(ev) {
        await maybeRefreshData();
        const error = ev.error;
        if (error.name === 'HTTPError' && (error.code == 401 || error.code == 403)) {
            console.warn("Server claims we are not registered!");
            await F.state.put('registered', false);
            location.replace(F.urls.install);
        } else if (error.name === 'HTTPError' && error.code == -1) {
            // Failed to connect to server
            console.warn("Connection Problem");
            _messageReceiver.close();
            _messageReceiver = null;
            _messageSender = null;
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
            console.error("Protocol error:", error);
            F.util.promptModal({
                header: "Protocol Error",
                content: error,
                icon: 'warning triangle red'
            });
        } else {
            throw error;
        }
    }

    async function onReadReceipt(ev) {
        await maybeRefreshData();
        F.readReceiptQueue.add({
            sent: ev.read.timestamp,
            sender: ev.read.sender,
            sourceDevice: ev.read.sourceDevice,
            read: ev.timestamp
        });
    }

    async function onDeliveryReceipt(ev) {
        await maybeRefreshData();
        const sync = ev.proto;
        F.deliveryReceiptQueue.add({
            sent: sync.timestamp.toNumber(),
            source: sync.source,
            sourceDevice: sync.sourceDevice
        });
    }
})();
