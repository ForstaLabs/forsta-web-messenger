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

F.activeWindows = async function() {
    const windows = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true
    });
    return windows;
};

async function init(userId) {
    await F.atlas.workerLogin(userId);
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
