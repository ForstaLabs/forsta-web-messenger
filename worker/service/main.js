// vim: ts=4:sw=4:expandtab
/* global skipWaiting clients firebase relay registration */

self.F = self.F || {};

addEventListener('install', function(ev) {
    skipWaiting(); // Force controlled clients to use us right away.
});

addEventListener('activate', function(ev) {
    ev.waitUntil(clients.claim());
});

const _messageListeners = [];
addEventListener('message', ev => {
    for (const cb of _messageListeners) {
        cb(ev);
    }
});

function addMessageListener(callback) {
    _messageListeners.push(callback);
}

function removeMessageListener(callback) {
    const idx = _messageListeners.indexOf(callback);
    if (idx !== -1) {
        _messageListeners.splice(idx, 1);
    }
}

addEventListener('dbversionchange', ev => {
    console.warn("Database version changed underneath us: Unregistering...");
    registration.unregister();
});
addEventListener('dbblocked', ev => {
    console.warn("Database blocked due to non-upgradeable database: Unregistering...");
    registration.unregister();
});

F.activeWindows = async function() {
    /* Because we use scope variances to support multiple logins/workers we need
     * to communicate with all the potential windows in our origin to see if one
     * of them is truly associated with this worker. */
    await F.loginReady;
    if (!F.currentUser) {
        // We've been logged out, no window can match us.
        return [];
    }
    const windows = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true
    });
    const candidates = new Set();
    for (const w of windows) {
        if ((new URL(w.url)).pathname.startsWith(F.urls.main)) {
            w.postMessage({op: 'identify'});
            candidates.add(w.id);
        }
    }
    if (!candidates.size) {
        return [];
    }
    const matches = [];
    let onResp;
    const findMatches = new Promise(resolve => {
        onResp = ev => {
            candidates.delete(ev.source.id);
            if (ev.data === F.currentUser.id) {
                matches.push(ev.source);
            }
            if (!candidates.size) {
                resolve();
            }
        };
    });
    addMessageListener(onResp);
    try {
        await Promise.race([relay.util.sleep(10), findMatches]);
    } finally {
        removeMessageListener(onResp);
    }
    return matches;
};

async function login(userId) {
    try {
        await F.atlas.workerLogin(userId);
    } catch(e) {
        if (e instanceof ReferenceError) {
            console.warn("Unregistering unusable service worker:", e);
            await registration.unregister();
        }
        throw e;
    }
}

F.loginReady = (function() {
    const m = location.search.match(/[?&]id=([^&]*)/);
    const userId = m && m[1];
    if (!userId) {
        throw new Error("User `id` query arg not present.");
    }
    return login(userId);
})();

async function init() {
    await F.cache.startSharedCache();
    await F.loginReady;
    await F.util.startIssueReporting();
    await F.foundation.initServiceWorker();
}

async function messageDrain() {
    console.info('GCM Wakeup request');
    await F.initReady;
    if ((await F.activeWindows()).length) {
        console.warn("Active clients found - Dropping GCM wakeup request");
        return;
    }
    await F.foundation.getMessageReceiver().drain();
}

if (F.env.FIREBASE_CONFIG) {
    firebase.initializeApp(F.env.FIREBASE_CONFIG);
    const fbm = firebase.messaging();
    const requestMessageDrain = _.debounce(() => {
        F.queueAsync('fb-msg-handler', messageDrain);
    }, 1000);

    const pendingPushPromises = [];
    F.notifications.on('added', (model, data) => {
        console.info("Notification displayed...");
        console.info("Resolve all pending push promises:", pendingPushPromises.length);
        for (const x of pendingPushPromises) {
            x.resolve();
        }
        pendingPushPromises.length = 0;
    });

    fbm.setBackgroundMessageHandler(() => {
        // This is complicated because browsers don't permit silent-push.
        // We must return a promise that acts like a contract.  The contract states
        // that when it is resolved there is ALSO a visible notification.  If we know
        // for a fact that none are present, we can attempt to reserve some of our
        // silent-push "budget", otherwise the browser will complain with the infamous
        // "This site has been updated in the background"
        if (!F.initReady) {
            F.initReady = init();
        }
        const contract = new Promise(resolve => pendingPushPromises.push({resolve}));
        requestMessageDrain();
        return contract;
    });
}
