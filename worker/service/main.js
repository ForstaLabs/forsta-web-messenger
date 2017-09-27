// vim: ts=4:sw=4:expandtab

self.F = self.F || {};

firebase.initializeApp(F.env.FIREBASE_CONFIG);

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
async function messageDrain() {
    if ((await F.activeWindows()).length) {
        console.warn("Active clients found - Dropping GCM wakeup request");
        // XXX Clear our existing notifications here I think...
        return;
    }
    console.info('GCM Wakeup request');
    if (!_init) {
        console.info('Starting messaging foundation...');
        _init = true;
        const userId = location.search.split('?id=')[1]; // XXX
        await F.ccsm.workerLogin(userId);
        await F.cache.validate();
        await F.foundation.initServiceWorker();
    }
    await F.foundation.getMessageReceiver().drain();
}

const requestMessageDrain = _.debounce(() => F.queueAsync('fb-msg-handler', messageDrain), 1000);
const fbm = firebase.messaging();
fbm.setBackgroundMessageHandler(function(payload) {
    requestMessageDrain();
    return F.util.never(); // Prevent "site has been updated in back..."
});
