/*
 * vim: ts=4:sw=4:expandtab
 */

;(function () {
    'use strict';

    window.Forsta = window.Forsta || {};
    Forsta.util = {};

    /* Emulate Python's asyncio.as_completed */
    Forsta.util.as_completed = function*(promises) {
        const pending = new Set(promises);
        for (const p of pending) {
            p.then(function resolved(v) {
                pending.delete(p);
                return v;
            }, function rejected(e) {
                pending.delete(p);
                throw e;
            });
        }
        while (pending.size) {
            yield Promise.race(pending);
        }
    };

    Forsta.util.sleep = async function(seconds) {
        return new Promise(r => setTimeout(r, seconds * 1000));
    };
})();
