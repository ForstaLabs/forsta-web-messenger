/*
 * vim: ts=4:sw=4:expandtab
 *
 * See: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
 * TL;DR; This gets downloaded every 24 hours.
 */


firebase.initializeApp(forsta_env.FIREBASE_CONFIG);
const fbm = firebase.messaging();

self._installed = 0;
self._updated = 0;
self._message = 0;

addEventListener('install', function(ev) {
    console.warn("SERVICE INSTALL", ev);
});
addEventListener('activate', function(ev) {
    console.warn("SERVICE ACTIVATE", ev);
    ev.waitUntil(main());
});
addEventListener('update', async function(ev) {
    _updated += 1;
    console.warn("Update EVENT!!!!", _updated, ev);
});
addEventListener('message', async function(ev) {
    _message += 1;
    console.warn("Message EVENT 555 !!!!", _message, ev);
    const data = ev.data.data;
    for (const key in data) {
        console.log("Setting:", key, data);
        localStorage.setItem(key, data[key]);
    }
    F.foundation.initApp();
});
addEventListener('push', async function(ev) {
    console.warn("PUSH EVENT!!!!", ev);
});

async function main() {
    await textsecure.init(new SignalProtocolStore());

    fbm.setBackgroundMessageHandler(function(payload) {
        console.info('Received background message!', payload);
        /* XXX TBD. */
        const notificationTitle = 'Message waiting from' + payload.from;
        const notificationOptions = {
            body: 'Well, it\'s a alive, not do something with it:' + JSON.stringify(payload)
        };
        return self.registration.showNotification(notificationTitle, notificationOptions);
    });
}
