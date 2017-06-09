/*
 * vim: ts=4:sw=4:expandtab
 */

;(function () {
    'use strict';

    window.F = window.F || {};
    F.util = {};

    /* Emulate Python's asyncio.as_completed */
    F.util.as_completed = function*(promises) {
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

    F.util.sleep = async function(seconds) {
        return new Promise(r => setTimeout(r, seconds * 1000));
    };

    F.util.htmlSanitize = function(dirty_html_str) {
        return DOMPurify.sanitize(dirty_html_str, {
            ALLOWED_TAGS: ['p', 'b', 'i', 'del', 'pre', 'code', 'br', 'hr',
                           'div', 'span'],
            FORBID_ATTR: ['style', 'class']
        });
    };
})();
