/*
 * vim: ts=4:sw=4:expandtab
 */
;(function() {
    'use strict';

    const WORKER_SCRIPT = F.urls.static + 'service-worker.js';

    F.BackgroundNotificationService = function() {
        this.signalServer = F.foundation.getAccountManager().server;
    };
    const cls = F.BackgroundNotificationService.prototype;

    /* Check if server has the token in question. */
    cls.isKnownToken = function(token) {
        const curHash = storage.get('serverGcmHash');
        return curHash === md5(token);
    };

    cls.saveKnownToken = function(token) {
        if (token) {
            storage.put('serverGcmHash', md5(token));
        } else {
            storage.remove('serverGcmHash');
        }
    };

    cls.shareTokenWithSignal = async function(token) {
        console.info("Updating GCM Registration ID " +
                     "(ie. Firebase Messagin Token/RcptID)");
        try {
            await this.signalServer.updateGcmRegistrationId(token);
        } catch(e) {
            this.saveKnownToken(null);
            throw e;
        }
        this.saveKnownToken(token);
    };

    cls.registerServiceWorker = async function() {
        console.info("Registering ServiceWorker for Firebase messaging");
        console.assert(Notification.permission === 'granted');
        const reg = await navigator.serviceWorker.register(WORKER_SCRIPT, {
            scope: F.urls.static
        });
        const worker = reg.installing || reg.waiting || reg.active;
        worker.postMessage({subtype: 'storage', data: _.extend({}, localStorage)});
        if (0) {
            /* Monitor state changes until we are activated. */
            console.warn("Waiting for ServiceWorker to activate...");
            await new Promise((resolve, reject) => {
                const onStateChange = ev => {
                    const state = ev.target.state;
                    if (state === 'installed') {
                        console.info("ServiceWorker is now installed (almost there).");
                    } else if (state === 'activating') {
                        console.info("ServiceWorker is now activating (nearly nearly there).");
                    } else if (state === 'activated') {
                        console.info("ServiceWorker is now active.");
                        worker.removeEventListener('statechange', onStateChange);
                        resolve();
                    } else {
                        reject(new Error(`Unexpected ServiceWorkerRegistration state: ${state}`));
                    }
                };
                try {
                    worker.addEventListener('statechange', onStateChange);
                } catch(e) {
                    reject(e);
                }
            });
        }
        this.worker = worker;
        return reg;
    };

    /* Loads or creates a messaging token used by Signal server to find us.
     * Also establishes a monitor in case the token changes. */
    cls.setupToken = async function() {
        const token = await this.fbm.getToken();
        if (token) {
            if (!this.isKnownToken(token)) {
                await this.shareTokenWithSignal(token);
            }
        } else {
            throw new Error("Did not get token for FBM; Permissions granted?");
        }
        this.fbm.onTokenRefresh(async function() {
            console.info('Firebase messaging token refreshed.');
            await this.shareTokenWithSignal(await this.fbm.getToken());
        });
    };

    /* Create a ServiceWorker so that we can be notified of new messages when
     * our page is unloaded. */
    cls.start = async function() {
        if (!('serviceWorker' in navigator && forsta_env.FIREBASE_CONFIG)) {
            console.warn("Notifications will not work when page is unloaded.");
            return false;
        }
        console.info("Initializing Firebase application");
        firebase.initializeApp(forsta_env.FIREBASE_CONFIG);
        this.fbm = firebase.messaging();
        this.serviceWorker = await this.registerServiceWorker();
        this.fbm.useServiceWorker(this.serviceWorker);
        await this.setupToken();

        /*
         * This is more for testing.  Our websocket handles notifications
         * when our page is loaded.  The signal server is configured to only
         * use GCM when a websocket send isn't possible, so this will likely
         * only happen during corner cases with network outages.
         */
        this.fbm.onMessage(function(payload) {
            console.warn("Unexpected firebase message in foreground");
        });
        return true;
    };
})();
