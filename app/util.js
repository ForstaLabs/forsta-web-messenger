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
            ALLOWED_TAGS: ['p', 'b', 'i', 'u', 'del', 'pre', 'code', 'br', 'hr',
                           'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                           'em', 'time', 'mark', 'blockquote', 'ul', 'ol', 'li',
                           'dd', 'dl', 'dt', 'a', 'abbr', 'cite', 'dfn', 'q',
                           'kbd', 'samp', 'small', 's', 'ins', 'strong', 'sub',
                           'sup', 'var', 'wbr', 'audio', 'img', 'video'],
            FORBID_ATTR: ['style', 'class'] // XXX verify onclick and other ev attrs don't work.
        });
    };

    DOMPurify.addHook('afterSanitizeAttributes', function(node) {
        // set all link elements target to target=_blank
        if ('target' in node) {
            node.setAttribute('target', '_blank');
        }
    });
})();
