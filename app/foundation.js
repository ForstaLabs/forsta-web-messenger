// vim: ts=4:sw=4:expandtab
/* global relay platform */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.foundation = {};

    const server_url = F.env.SIGNAL_URL;
    const dataRefreshThreshold = 3600;

    async function refreshDataBackgroundTask() {
        const active_refresh = 600;
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
        const store = ns.relayStore = new F.RelayStore();
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
        addEventListener('syncRequest', F.sync.processRequest);
    };

    ns.initApp = async function() {
        await ns.initCommon();
        const signal = await ns.makeSignalServer();
        const signalingKey = await F.state.get('signalingKey');
        const addr = await F.state.get('addr');
        F.currentDevice = await F.state.get('deviceId');
        _messageSender = new relay.MessageSender(signal, addr);
        _messageReceiver = new relay.MessageReceiver(signal, addr, F.currentDevice, signalingKey);
        await ns.allThreads.fetchOrdered();
        _messageSender.addEventListener('error', onSendError);
        _messageSender.addEventListener('keychange', onEgressKeyChange);
        _messageReceiver.addEventListener('keychange', onIngressKeyChange);
        _messageReceiver.addEventListener('message', onMessageReceived);
        _messageReceiver.addEventListener('receipt', onDeliveryReceipt);
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
        F.currentDevice = await F.state.get('deviceId');
        _messageSender = new relay.MessageSender(signal, addr);
        _messageReceiver = new relay.MessageReceiver(signal, addr, F.currentDevice, signalingKey,
                                                     /*noWebSocket*/ true);
        await ns.allThreads.fetchOrdered();
        _messageSender.addEventListener('error', onSendError);
        _messageSender.addEventListener('keychange', onEgressKeyChange);
        _messageReceiver.addEventListener('keychange', onIngressKeyChange);
        _messageReceiver.addEventListener('message', onMessageReceived);
        _messageReceiver.addEventListener('receipt', onDeliveryReceipt);
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

    let _lastDataRefresh = Date.now();
    async function maybeRefreshData(force) {
        /* If we've been idle for long, refresh data stores. */
        const now = Date.now();
        const elapsed = (now - _lastDataRefresh) / 1000;
        if (force || elapsed > dataRefreshThreshold) {
            _lastDataRefresh = now;
            console.debug("Foundation data refresh");
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
        console.debug("Received message:", message);
        await message.handleDataMessage(data.message);
    }

    function identityMatch(a, b) {
        return a instanceof Uint8Array &&
            b instanceof Uint8Array &&
            a.length === b.length &&
            a.every((x, i) => x === b[i]);
    }

    async function onIngressKeyChange(ev) {
        const user = await F.atlas.getContact(ev.keyError.addr);
        const trust = await user.getTrustedIdentity();
        if (!trust) {
            // This identity isn't considered trusted, so just let it go..
            console.warn("Auto-accepting new identity key for: " + user);
            await ev.accept();
            return;
        }
        if (identityMatch(trust.get('identityKey'), new Uint8Array(ev.keyError.identityKey))) {
            console.info("New identity is already trusted for: " + user);
            await ev.accept();
        } else {
            console.error("Destroying identity trust for: " + user);
            await user.destroyTrustedIdentity();
        }
    }

    async function onEgressKeyChange(ev) {
        const user = await F.atlas.getContact(ev.keyError.addr);
        const trust = await user.getTrustedIdentity();
        if (!trust) {
            // This identity isn't considered trusted, so just let it go..
            console.warn("Auto-accepting new identity key for: " + user);
            await ev.accept();
            return;
        }
        const proposedIdentityKey = new Uint8Array(ev.keyError.identityKey);
        if (identityMatch(trust.get('identityKey'), proposedIdentityKey)) {
            console.info("New identity is already trusted for: " + user);
            await ev.accept();
        } else {
            await user.save({proposedIdentityKey});
            const newIdentPhrase = await user.getIdentityPhrase(/*proposed*/ true);
            const isValid = await F.util.confirmModal({
                closable: false,
                header: 'Identity Change Detected!',
                icon: 'spy red',
                size: 'tiny',
                content: `<h4>The identity key for <b>${user.getTagSlug()}</b> has changed.</h4>` +
                         `Because you had previously marked this contact as trusted you must ` +
                         `verify the new identity phrase.  We recommend you use a 3rd party ` +
                         `communication technique (e.g. in-person dialog, telephone, etc) to ` +
                         `validate the new identity phrase below..` +
                         `<div class="identity-phrase centered">${newIdentPhrase}</div>`,
                confirmLabel: 'I trust this new identity phrase',
                confirmClass: 'yellow',
                confirmIcon: 'handshake',
                dismissLabel: 'Abort Send',
                dismissIcon: 'thumbs down',
                dismissClass: 'red',
            });
            if (isValid) {
                console.warn("Accepting new identity key for: " + user);
                await user.updateTrustedIdentity(/*proposed*/ true);
                await ev.accept();
            } else {
                console.error("Not accepting new identity key for: " + user);
            }
        }
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
        console.debug("Received sent-sync:", message);
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
