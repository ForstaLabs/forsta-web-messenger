/*
 * vim: ts=4:sw=4:expandtab
 *
 * Browers have different levels of support for workers.  Use the best
 * one available on a given platform and provide a common interface for
 * communicating here.
 *
 * Worker selection priority:
 *   1: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
 *       a. Offloaded crypto processing (out of UI thread)
 *       b. Tab/window concurrency managment.
 *       c. Background notification capablilty
 *       d. Background message processing (zero catch up proccesing)
 *
 *   2: https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker
 *       a. Offloaded crypto processing (out of UI thread)
 *       b. Tab/window concurrency managment.
 *
 *   3: https://developer.mozilla.org/en-US/docs/Web/API/Worker
 *       a. Offloaded crypto processing (out of UI thread)
 *
 *   4: No Worker at all!
 * 
 */

;(function() {
    'use strict';

    self.F = self.F || {};
    F.worker = F.worker || {};

    const worker_scripts = {
        service: 'worker-service.js'
    };

    class BridgeAbstract {
        constructor() {
            this._event_listeners = {};
        }

        async install() {
            throw new Error('Subclass Impl Required');
        }

        async rpc(event, data) {
            throw new Error('Subclass Impl Required');
        }

        subscribe(event, func_or_awaitable, prio) {
            /* Listen for events of a particular name.  If the function is
             * an async function it will be awaited before other callbacks
             * are executed.  Setting `prio` will rank the callback order
             * compared to other listeners.  Lower prio runs first.
             */
            const tuple = [prio === undefined ? 50 : prio, func_or_awaitable];
            this._event_listeners.push(tuple);
            this._event_listeners.sort((a, b) => a[0] - b[0]);
        }

        async _invoke(event, data) {
            /* Listen for events of a particular name.  If the function is
             * an async function it will be awaited before other callbacks
             * are executed.  Setting `prio` will rank the callback order
             * compared to other listeners.  Lower prio runs first.
             */
            for (const x of this._event_listeners) {
                const maybe_promise = x[1](data);
                if (maybe_promise instanceof Promise) {
                    await maybe_promise;
                }
            }
        }
    }

    class ServiceWorkerBridge extends BridgeAbstract {

        constructor() {
            super();
            const sw = navigator.serviceWorker;
            sw.addEventListener('controllerchange', this.onControllerChange.bind(this));
            sw.addEventListener('message', this.onMessage.bind(this));
            sw.addEventListener('error', this.onError.bind(this));
            this._pending = {};
            this._pending_id_offt = 0;
        }

        async install() {
            await this.bindWorker(await this.getWorker());
        }

        rpc(method) {
            /* Generate a function wrapper for a bridge RPC call.
             * The resulting function can take any argument signature
             * and will always return a Promise. */
            return function() {
                const pending = this.addPending();
                this._worker.postMessage({
                    subtype: 'bridge-rpc',
                    id: pending.id,
                    method,
                    args: Array.from(arguments)
                });
                return pending.promise;
            }.bind(this);
        }

        addPending() {
            const id = this._pending_id_offt++;
            const pending = {id};
            pending.promise = new Promise((resolve, reject) => {
                pending.resolve = resolve;
                pending.reject = reject;
            });
            this._pending[id] = pending;
            return pending;
        }

        onControllerChange(ev) {
            console.warn('ServiceWorker changed');
            throw new Error("Unhandled service worker change");
        }

        onError(ev) {
            console.error('ServiceWorker Error', ev);
            throw new Error("ServiceWorkerContainer Error");
        }

        onMessage(ev) {
            console.info("Service Worker Message", ev);
            if (ev.data.subtype !== 'bridge-rpc') {
                return;
            }
            ev.stopPropagation();
            const pending = this._pending[ev.data.id];
            delete this._pending[ev.data.id];
            if (ev.data.success) {
                pending.resolve(ev.data.result);
            } else {
                const exc = ev.data.exception;
                const error = new Error(exc.message);
                error.name = exc.name;
                error.stack = exc.stack;
                pending.reject(error);
            }
        }

        async onRegUpdate(reg) {
            /* Order matters; Sometimes `installing` is the new one while `active` is set
             * to the soon to be redundant one. */
            const sw = reg.installing || reg.waiting || reg.active;
            if (sw !== this._worker) {
                debugger;
                console.warn("Replacing existing ServiceWorker with new one.");
                await this.bindWorker(sw);
            } else {
                throw new Error("oh shit");
            }
        }

        async getWorker() {
            const url = F.urls.main + worker_scripts.service;
            const reg = await navigator.serviceWorker.register(url, {scope: F.urls.main});
            console.warn("initial reg is", reg);
            reg.addEventListener('updatefound', ev => ev.waitUntil(this.onRegUpdate(ev.target)));
            const worker = reg.installing || reg.waiting || reg.active;
            reg.update();
            return worker;
        }

        async bindWorker(worker) {
            console.info("Binding ServiceWorker:", worker);
            this._worker = worker;
            worker.addEventListener('message', this._onMessage);
            worker.addEventListener('statechange', function(ev) {
                if (ev.target.state === 'redundant') {
                    if (ev.target === this._worker) {
                        this._worker = null;
                    }
                }
                console.warn('statechange', ev.target);
            if (!this._bgService) {
                this._bgService = new BackgroundNotificationService();
            }
            await this._bgService.start();
        }
    }

    class SharedWorkerBridge extends BridgeAbstract {
    }

    class WorkerBridge extends BridgeAbstract {
    }

    class PseudoBridge extends BridgeAbstract {
    }

    class BackgroundNotificationService {

        constructor() {
            console.info("Initializing Firebase application");
            firebase.initializeApp(forsta_env.FIREBASE_CONFIG);
        }

        async start() {
            /* Create a ServiceWorker so that we can be notified of new messages when
             * our page is unloaded. */
            if (!('serviceWorker' in navigator && forsta_env.FIREBASE_CONFIG)) {
                console.warn("Notifications will not work when page is unloaded.");
                return false;
            }
            this.signalServer = (await F.foundation.getAccountManager()).server;
            const reg = await navigator.serviceWorker.getRegistration(F.urls.main);
            //reg.update();
            console.info("Firebase messaging using:", reg);
            this.fbm = firebase.messaging();
            this.fbm.useServiceWorker(reg);
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
        }

        async isKnownToken(token) {
            /* Check if server has the token in question. */
            const curHash = await F.state.get('serverGcmHash');
            return curHash === md5(token);
        }

        async saveKnownToken(token) {
            if (token) {
                await F.state.put('serverGcmHash', md5(token));
            } else {
                await F.state.remove('serverGcmHash');
            }
        }

        async shareTokenWithSignal(token) {
            console.info("Updating GCM Registration ID " +
                         "(ie. Firebase Messagin Token/RcptID)");
            try {
                // XXX can we do all this Inside the service worker? 
                await this.signalServer.updateGcmRegistrationId(token);
            } catch(e) {
                await this.saveKnownToken(null);
                throw e;
            }
            await this.saveKnownToken(token);
        }

        async setupToken() {
            /* Loads or creates a messaging token used by Signal server to find us.
             * Also establishes a monitor in case the token changes. */
            console.warn("GETTOKEN XXX");
            const token = await this.fbm.getToken();
            if (token) {
                if (!(await this.isKnownToken(token))) {
                    await this.shareTokenWithSignal(token);
                }
            } else {
                throw new Error("Did not get token for FBM; Permissions granted?");
            }
            this.fbm.onTokenRefresh(async function() {
                console.info('Firebase messaging token refreshed.');
                console.warn("GETTOKEN XXX");
                await this.shareTokenWithSignal(await this.fbm.getToken());
            });
        }
    }

    F.worker.makeBridge = async function() {
        /* Find best worker for this platform and start it up if needed. */
        const b = new ServiceWorkerBridge();
        await b.install();
        return b;
    };
})();
