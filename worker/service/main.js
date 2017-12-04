// vim: ts=4:sw=4:expandtab
/* global skipWaiting clients firebase relay */

self.F = self.F || {};

F.util.startIssueReporting();

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

F.activeWindows = async function() {
    /* Because we use scope variances to support multiple logins/workers we need
     * to communicate with all the potential windows in our origin to see if one
     * of them is truly associated with this worker. */
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

async function init(userId) {
    try {
        await F.atlas.workerLogin(userId);
    } catch(e) {
        if (e instanceof ReferenceError) {
            console.warn("Unregistering unusable service worker:", e);
            await registration.unregister();
        }
        throw e;
    }
    await F.cache.validate();
    await F.foundation.initServiceWorker();
}

async function messageDrain() {
    console.info('GCM Wakeup request');
    if ((await F.activeWindows()).length) {
        console.warn("Active clients found - Dropping GCM wakeup request");
        return;
    }
    await F.foundation.getMessageReceiver().drain();
}

if (F.env.FIREBASE_CONFIG) {
    const m = location.search.match(/[?&]id=([^&]*)/);
    const userId = m && m[1];
    if (!userId) {
        throw new Error("User `id` query arg not present.");
    }
    const initDone = init(userId);
    firebase.initializeApp(F.env.FIREBASE_CONFIG);
    const fbm = firebase.messaging();
    const requestMessageDrain = _.debounce(() => {
        F.queueAsync('fb-msg-handler', () => initDone.then(messageDrain));
    }, 1000);
    fbm.setBackgroundMessageHandler(payload => {
        requestMessageDrain();
        return relay.util.never(); // Prevent "site has been updated in back..."
    });
}
