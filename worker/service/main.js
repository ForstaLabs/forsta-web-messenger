// vim: ts=4:sw=4:expandtab

self.F = self.F || {};


addEventListener('install', function(ev) {
    skipWaiting(); // Force controlled clients to use us right away.
});

addEventListener('activate', function(ev) {
    ev.waitUntil(clients.claim());
});

F.activeWindows = async function() {
    return await clients.matchAll({type: 'window'});
}

let _init;
async function messageDrain(userId) {
    if ((await F.activeWindows()).length) {
        console.warn("Active clients found - Dropping GCM wakeup request");
        // XXX Clear our existing notifications here I think...
        return;
    }
    console.info('GCM Wakeup request');
    if (!_init) {
        console.info('Starting messaging foundation...');
        _init = true;
        await F.ccsm.workerLogin(userId);
        await F.cache.validate();
        await F.foundation.initServiceWorker();
    }
    await F.foundation.getMessageReceiver().drain();
}

if (F.env.FIREBASE_CONFIG) {
    const m = location.search.match(/[?&]id=([^&]*)/);
    const userId = m && m[1];
    if (!userId) {
        console.error("User `id` query arg not present.");
    } else {
        firebase.initializeApp(F.env.FIREBASE_CONFIG);
        const fbm = firebase.messaging();
        const requestMessageDrain = _.debounce(() => {
            F.queueAsync('fb-msg-handler', messageDrain.bind(null, userId))
        }, 1000);
        fbm.setBackgroundMessageHandler(function(payload) {
            requestMessageDrain();
            return F.util.never(); // Prevent "site has been updated in back..."
        });
    }
}
