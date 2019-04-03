// vim: ts=4:sw=4:expandtab
/* global relay platform libsignal */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.foundation = {};

    const server_url = F.env.SIGNAL_URL;
    const dataRefreshThreshold = 3600;
    const sessionId = F.util.uuid4();

    ns.relayStore = new F.RelayStore();
    relay.setStore(ns.relayStore);


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

    async function msgReceiverConnect(signal) {
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
    }

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

    let _initRelayDone;
    ns.initRelay = async function() {
        if (_initRelayDone) {
            return;
        }
        const protoPath = F.urls.static + 'protos/';
        const protoQuery = `?v=${F.env.GIT_COMMIT.substring(0, 8)}`;
        await relay.loadProtobufs(protoPath, protoQuery);
        _initRelayDone = true;
    };

    ns.initCommon = async function() {
        if (!(await F.state.get('registered'))) {
            throw new Error('Not Registered');
        }
        if (_messageReceiver || _messageSender) {
            throw new TypeError("Already initialized");
        }
        await ns.initRelay();
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
        const am = await ns.getAccountManager();
        am.refreshPreKeys();  // bg okay
    };

    ns.initApp = async function() {
        await ns.initCommon();
        initEnsureOnlyOneMonitor();
        const signal = await ns.makeSignalServer();
        const signalingKey = await F.state.get('signalingKey');
        const addr = await F.state.get('addr');
        F.currentDevice = await F.state.get('deviceId');
        _messageSender = new relay.MessageSender(signal, addr);
        _messageReceiver = new relay.MessageReceiver(signal, addr, F.currentDevice, signalingKey);
        await ns.allThreads.fetchOrdered();
        _messageSender.addEventListener('error', onSenderError);
        _messageSender.addEventListener('keychange', onEgressKeyChange);
        _messageReceiver.addEventListener('keychange', onIngressKeyChange);
        _messageReceiver.addEventListener('message', onMessageReceived);
        _messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        _messageReceiver.addEventListener('sent', onSentMessage);
        _messageReceiver.addEventListener('read', onReadReceipt);
        _messageReceiver.addEventListener('closingsession', onClosingSession);
        _messageReceiver.addEventListener('error', onReceiverError);
        msgReceiverConnect(signal);  // bg okay
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
        _messageSender.addEventListener('error', onSenderError);
        _messageSender.addEventListener('keychange', onEgressKeyChange);
        _messageReceiver.addEventListener('keychange', onIngressKeyChange);
        _messageReceiver.addEventListener('message', onMessageReceived);
        _messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        _messageReceiver.addEventListener('sent', onSentMessage);
        _messageReceiver.addEventListener('read', onReadReceipt);
        _messageReceiver.addEventListener('closingsession', onClosingSession);
        _messageReceiver.addEventListener('error', onReceiverError);
        ns.fetchData();  // bg okay
    };

    ns.autoProvision = async function(initCallback, confirmCallback) {
        async function fwdUrl(uuid, key) {
            await relay.hub.fetchAtlas('/v1/provision/request', {
                method: 'POST',
                json: {uuid, key}
            });
            if (initCallback) {
                await initCallback({uuid, key});
            }
        }
        async function confirmAddr(addr) {
            if (addr !== F.currentUser.id) {
                throw new Error("Foreign account sent us an identity key!");
            }
            if (confirmCallback) {
                await confirmCallback();
            }
        }
        const am = await ns.getAccountManager();
        const name = F.foundation.generateDeviceName();
        return await am.registerDevice(name, fwdUrl, confirmAddr);
    };

    ns.stopServices = function() {
        const mr = ns.getMessageReceiver();
        if (mr) {
            mr.close();
        }
    };

    const ensureOnlyOneKey = 'ensureOnlyOne';

    function initEnsureOnlyOneMonitor() {
        /* Detect duplicate sessions by pinging any other active tabs to the same
         * origin.  If they are using the same userId then they will suspend themselves.
         * Likewise, setup the monitor for receiving these same pings. */
        const userId = F.currentUser.id;
        addEventListener('storage', onEnsureOnlyOneStorageEvent);
        localStorage.setItem(ensureOnlyOneKey, JSON.stringify({sessionId, userId}));
    }

    function onEnsureOnlyOneStorageEvent(ev) {
        if (ev.key !== ensureOnlyOneKey) {
            return;
        }
        const data = JSON.parse(ev.newValue);
        if (data.sessionId === sessionId || data.userId !== F.currentUser.id) {
            return;
        }
        removeEventListener('storage', onEnsureOnlyOneStorageEvent);
        suspendSession();
    }

    async function suspendSession() {
        console.warn("Suspending this session due to duplicate tab/window");
        ns.stopServices();
        await F.util.confirmModal({
            header: 'Session Suspended',
            icon: 'pause circle',
            content: 'Another tab was opened on this computer.',
            footer: 'Only one session per browser can be active to avoid ' +
                    'consistency problems.',
            confirmLabel: 'Restart this session',
            confirmIcon: 'refresh',
            dismiss: false,
            closable: false
        });
        location.reload();
        await relay.util.never();
    }

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
            flags: data.message.flags,
            serverAge: data.age
        });
        console.debug("Received message:", data);
        message.handleDataMessage(data.message);
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
        const proposedIdentityKey = new Uint8Array(ev.keyError.identityKey);
        if (identityMatch(trust.get('identityKey'), proposedIdentityKey)) {
            console.info("New identity is already trusted for: " + user);
            await ev.accept();
        } else {
            console.warn("Quarantining message from untrusted: " + user);
            const envData = Object.assign({}, ev.envelope);
            envData.protobuf = ev.envelope.toArrayBuffer();  // Store the entire thing too.
            delete envData.content;  // remove redundant buffer.
            delete envData.legacyMessage;  // remove redundant buffer.
            const msg = new F.QuarantinedMessage(envData);
            await msg.save();

            if (!identityMatch(user.get('proposedIdentityKey'), proposedIdentityKey)) {
                await user.save({proposedIdentityKey});
                if (!self.document) {
                    return;  // Only do visual notification for UI thread
                }
                /* Run this confirm in the BG to avoid clogging our incoming msg stream */
                (async function() {
                    const newIdentPhrase = await user.getIdentityPhrase(/*proposed*/ true);
                    const isValid = await F.util.confirmModal({
                        closable: false,
                        header: 'Identity Change Detected!',
                        icon: 'spy red',
                        size: 'tiny',
                        content: `<h4>The identity key for <b>${user.getTagSlug()}</b> has changed.</h4>` +
                                 `Because you had previously marked this contact as trusted you must ` +
                                 `verify the new identity phrase...` +
                                 `<div class="identity-phrase centered">${newIdentPhrase}</div>` +
                                 `<i>We recommend you use a 3rd party communication technique ` +
                                 `(e.g. in-person dialog, telephone, etc) to validate the identity ` +
                                 `phrase.</i>`,
                        confirmLabel: 'Trust New Identity',
                        confirmClass: 'yellow',
                        confirmIcon: 'handshake'
                    });
                    if (isValid) {
                        console.warn("Accepting new identity key for: " + user);
                        await user.trustIdentity(/*proposed*/ true);
                    } else {
                        console.error("Not accepting new identity key for: " + user);
                    }
                })();
            }
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
            if (!self.document) {
                console.error("Worker can't accept new identity key for: " + user);
                return;
            }
            const newIdentPhrase = await user.getIdentityPhrase(/*proposed*/ true);
            const isValid = await F.util.confirmModal({
                closable: false,
                header: 'Identity Change Detected!',
                icon: 'spy red',
                size: 'tiny',
                content: `<h4>The identity key for <b>${user.getTagSlug()}</b> has changed.</h4>` +
                         `Because you had previously marked this contact as trusted you must ` +
                         `verify the new identity phrase...` +
                         `<div class="identity-phrase centered">${newIdentPhrase}</div>` +
                         `<i>We recommend you use a 3rd party communication technique ` +
                         `(e.g. in-person dialog, telephone, etc) to validate the identity ` +
                         `phrase.</i>`,
                confirmLabel: 'Trust New Identity',
                confirmClass: 'yellow',
                confirmIcon: 'handshake',
                dismissLabel: 'Cancel Send',
                dismissClass: 'red',
            });
            if (isValid) {
                console.warn("Accepting new identity key for: " + user);
                await user.trustIdentity(/*proposed*/ true);
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
            flags: data.message.flags,
            serverAge: data.age
        });
        console.debug("Received sent-sync:", message);
        message.handleDataMessage(data.message);
    }

    async function onReceiverError(ev) {
        const error = ev.error;
        if (error instanceof relay.ProtocolError &&
            (error.code === 401 || error.code === 403)) {
            console.error("Recv Auth Error");
            await F.util.resetRegistration();  // reloads page
        } else {
            F.util.reportError('Message Receiver Error: ' + error.message, {ev});
            console.debug('Error stack:', error.stack);
        }
    }

    async function onSenderError(ev) {
        const error = ev.error;
        if (error.code === 401 || error.code === 403) {
            console.error("Send Auth Error");
            await F.util.resetRegistration();  // reloads page
            return;
        } else {
            F.util.reportError('Message Sender Error: ' + error.message, {ev});
            console.debug('Error stack:', error.stack);
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

    async function onClosingSession(ev) {
        /* Check for duplicates and prevent session reset behavior if we already have the message. */
        const errors = ev.sessionError.decryptErrors;
        if (errors && errors.find(x => x instanceof libsignal.MessageCounterError)) {
            const looking = new F.Message({sent: ev.envelope.timestamp});
            try {
                await looking.fetch();
            } catch(e) {
                return;  // Not found, so let session close proceed.
            }
            console.warn("Duplicate message detected.  Preventing session close.");
            ev.stop();
        }
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
