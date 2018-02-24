// vim: ts=4:sw=4:expandtab
/* global relay platform */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.foundation = {};

    const server_url = F.env.SIGNAL_URL;
    const dataRefreshThreshold = 1800;

    async function refreshDataBackgroundTask() {
        const active_refresh = 300;
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


    let _contacts;
    ns.getContacts = function() {
        if (!_contacts) {
            _contacts = new F.ContactCollection();
        }
        return _contacts;
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
        const signal = await ns.makeSignalServer();
        const accountManager = new relay.AccountManager(signal);
        accountManager.addEventListener('registration', async function() {
            await F.state.put('registered', true);
        });
        _accountManager = accountManager;
        return accountManager;
    };

    ns.makeSignalServer = async function() {
        const username = await F.state.get('username');
        const password = await F.state.get('password');
        return new relay.hub.SignalServer(server_url, username, password);
    };

    ns.fetchData = async function() {
        await Promise.all([
            ns.getUsers().fetch(),
            ns.getTags().fetch(),
        ]);
        await ns.getContacts().refresh();
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

    ns.initCommon = async function() {
        console.assert(_initRelay);
        if (!(await F.state.get('registered'))) {
            throw new Error('Not Registered');
        }
        if (_messageReceiver || _messageSender) {
            throw new TypeError("Already initialized");
        }
        ns.allThreads = new F.ThreadCollection();
        ns.pinnedThreads = new F.PinnedThreadCollection(ns.allThreads);
        ns.recentThreads = new F.RecentThreadCollection(ns.allThreads);
        ns.pinnedThreads.on("change:pinned", model => {
            ns.recentThreads.add(model);
            ns.pinnedThreads.remove(model);
        });
        ns.recentThreads.on("change:pinned", model => {
            // Make sure the change was to a truthy value, and not just undefined => false.
            if (model.get('pinned')) {
                ns.pinnedThreads.add(model);
                ns.recentThreads.remove(model);
            }
        });
    };

    ns.initApp = async function() {
        await ns.initCommon();
        const signal = await ns.makeSignalServer();
        const signalingKey = await F.state.get('signalingKey');
        const addr = await F.state.get('addr');
        const deviceId = await F.state.get('deviceId');
        _messageSender = new relay.MessageSender(signal, addr);
        _messageReceiver = new relay.MessageReceiver(signal, addr, deviceId, signalingKey);
        F.currentDevice = await F.state.get('deviceId');
        await ns.getContacts().fetch();
        await ns.allThreads.fetchOrdered();
        _messageSender.addEventListener('keychange', onKeyChange);
        _messageSender.addEventListener('error', onSendError);
        _messageReceiver.addEventListener('message', onMessageReceived);
        _messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        _messageReceiver.addEventListener('keychange', onKeyChange);
        _messageReceiver.addEventListener('sent', onSentMessage);
        _messageReceiver.addEventListener('read', onReadReceipt);
        _messageReceiver.addEventListener('error', onRecvError);
        try {
            await _messageReceiver.connect();
        } catch(e) {
            try {
                await signal.getDevices();
            } catch(e2) {
                if (e2.code === 401) {
                    await F.util.resetRegistration();  // reloads page
                }
                throw e2;
            }
            throw e;
        }
        ns.fetchData();  // bg okay
        refreshDataBackgroundTask();
    };

    ns.initServiceWorker = async function() {
        await ns.initCommon();
        const signal = await ns.makeSignalServer();
        const signalingKey = await F.state.get('signalingKey');
        const addr = await F.state.get('addr');
        const deviceId = await F.state.get('deviceId');
        _messageSender = new relay.MessageSender(signal, addr);
        _messageReceiver = new relay.MessageReceiver(signal, addr, deviceId, signalingKey,
                                                     /*noWebSocket*/ true);
        F.currentDevice = await F.state.get('deviceId');
        await ns.getContacts().fetch();
        await ns.allThreads.fetchOrdered();
        _messageSender.addEventListener('keychange', onKeyChange);
        _messageSender.addEventListener('error', onSendError);
        _messageReceiver.addEventListener('message', onMessageReceived);
        _messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        _messageReceiver.addEventListener('keychange', onKeyChange);
        _messageReceiver.addEventListener('sent', onSentMessage);
        _messageReceiver.addEventListener('read', onReadReceipt);
        _messageReceiver.addEventListener('error', onRecvError);
        ns.fetchData();  // bg okay
    };

    ns.autoProvision = async function() {
        console.assert(_initRelay);
        async function fwdUrl(uuid, key) {
            await relay.hub.fetchAtlas('/v1/provision/request', {
                method: 'POST',
                json: {uuid, key}
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

    ns.sendSyncRequest = async function(deviceId) {
        // Catalog our version of the world and request any updates from our peers.
        console.warn("Sending sync message request to:", deviceId ? deviceId : 'All Peers');
        const start = performance.now();
        const knownMessages = [];
        const knownThreads = [];
        const knownContacts = F.foundation.getContacts().map(x => x.id);
        for (const thread of ns.allThreads.models) {
            // This is intentionally slow to make this a less brutal operation.
            const mc = new F.MessageCollection([], {thread});
            await mc.fetchAll();
            for (const m of mc.models) {
                knownMessages.push(m.id);
            }
            knownThreads.push({
                id: thread.id,
                lastActivity: new Date(thread.get('timestamp'))
            });
            await relay.util.sleep(0.01);
        }
        const t = new F.Thread({}, {deferSetup: true});
        await t.sendSyncControl({
            control: 'syncRequest',
            devices: deviceId ? [deviceId] : undefined,
            knownMessages,
            knownThreads,
            knownContacts
        });
        console.debug('send message sync time', performance.now() - start);
    };

    let _lastDataRefresh = Date.now();
    async function maybeRefreshData(force) {
        /* If we've been idle for long, refresh data stores. */
        const now = Date.now();
        const elapsed = (now - _lastDataRefresh) / 1000;
        if (force || elapsed > dataRefreshThreshold) {
            _lastDataRefresh = now;
            console.count("Data refresh from network");
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
        console.warn("Auto-accepting new identity key for:", ev.keyError.addr);
        await ev.accept();
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
        await F.enqueueReadReceipt({
            sent: ev.read.timestamp,
            sender: ev.read.sender,
            senderDevice: ev.read.sourceDevice,
            read: ev.timestamp
        });
    }

    async function onDeliveryReceipt(ev) {
        await maybeRefreshData();
        const sync = ev.proto;
        await F.enqueueDeliveryReceipt({
            sent: sync.timestamp,
            sender: sync.source,
            senderDevice: sync.sourceDevice
        });
    }
})();
