/*
 * vim: ts=4:sw=4:expandtab
 *
 * See: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
 * TL;DR; This gets downloaded every 24 hours.
 */


firebase.initializeApp(forsta_env.FIREBASE_CONFIG);


addEventListener('install', function(ev) {
    console.warn("Service Worker Install");
    ev.waitUntil(skipWaiting());
});

addEventListener('activate', function(ev) {
    console.warn("Service Worker Activate");
    ev.waitUntil(clients.claim());
});

(function() {
    console.info("%cStarting Service Worker", 'font-size: 1.2em; font-weight: bold;');

    let _init;

    /* Must be called at root level so check that we are initialied each
     * invocation */
    addEventListener('message', async function(ev) {
        if (!_init) {
            await textsecure.init(new SignalProtocolStore());
            await F.foundation.initApp();
            _init = true;
        }

        if (ev.data.subtype !== 'bridge-rpc') {
            return; // Not for us.
        }
        ev.stopPropagation();
        const funcs = {
            sendMessageToNumber: textsecure.messaging.sendMessageToNumber,
            sendSyncMessage: textsecure.messaging.sendSyncMessage,
            syncReadMessages: textsecure.messaging.syncReadMessages
        };
        const fn = funcs[ev.data.method];
        let result;
        try {
            if (fn === undefined) {
                throw new Error(`RPC Method Not Found: ${fn}`);
            }
            result = fn.apply(null, ev.data.args);
            if (result instanceof Promise) {
                result = await result;
            }
        } catch(e) {
            return ev.source.postMessage({
                subtype: 'bridge-rpc',
                id: ev.data.id,
                success: false,
                exception: {
                    name: e.name,
                    message: e.message,
                    stack: e.stack
                }
            });
        }
        ev.source.postMessage({
            subtype: 'bridge-rpc',
            id: ev.data.id,
            success: true,
            result
        });
    });
})();


const fbm = firebase.messaging();
fbm.setBackgroundMessageHandler(function(payload) {
    console.info('Received background message!', payload);
    /* XXX TBD. */
    const notificationTitle = 'Message waiting from' + payload.from;
    const notificationOptions = {
        body: 'Well, it\'s a alive, not do something with it:' + JSON.stringify(payload)
    };
    return self.registration.showNotification(notificationTitle, notificationOptions);
});
