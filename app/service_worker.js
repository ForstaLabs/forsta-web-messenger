// vim: ts=4:sw=4:expandtab
/* global  */

(function() {
    'use strict';

    self.F = self.F || {};

    F.ServiceWorkerManager = class ServiceWorkerManager {

        constructor() {
            this._listeners = {};
        }

        addEventListener(event, callback) {
            if (!this._listeners[event]) {
                this._listeners[event] = [callback];
            } else {
                this._listeners[event].push(callback);
            }
        }

        removeEventListener(event, callback) {
            this._listeners[event] = this._listeners[event].filter(x => x !== callback);
        }

        async triggerEvent(event) {
            const callbacks = this._listeners[event];
            if (!callbacks || !callbacks.length) {
                return;
            }
            const args = Array.from(arguments);
            args.shift();
            for (const callback of callbacks) {
                try {
                    await callback.apply(this, args);
                } catch(e) {
                    console.error("ServiceWorkerManager trigger event error:", e);
                } 
            }
        }

        async start() {
            navigator.serviceWorker.addEventListener('controllerchange',
                this.onControllerChange.bind(this));
            const version = F.env.GIT_COMMIT.substring(0, 8);
            const url = `${F.urls.worker_service}?id=${F.currentUser.id}&v=${version}`;
            const reg = await navigator.serviceWorker.register(url);
            reg.addEventListener('updatefound', ev => this.bindReg(ev.target));
            await this.bindReg(reg);
            F.util.sleep(15).then(reg.update.bind(reg));
        }

        async onControllerChange(ev) {
            /* TODO Probably reset state and restart fbm here... */
            console.warn('Unhandled ServiceWorker change');
        }

        async bindReg(reg) {
            if (this._reg === reg) {
                return;
            }
            this._reg = reg;
            await this.triggerEvent('bindregistration', reg);
        }

        getRegistration() {
            return this._reg;
        }
    };
})();
