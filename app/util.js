/*
 * vim: ts=4:sw=4:expandtab
 */

;(function () {
    'use strict';

    self.F = self.F || {};
    F.util = {};
    F.urls = {
        main: '/@',
        login: '/login',
        logout: '/logout',
        static: '/@static/',
        install: '/@install',
        register: '/@register',
        templates: '/@static/templates/',
        worker_service: '/@worker-service.js'
    };

    self.DOMPurify && DOMPurify.addHook('afterSanitizeAttributes', node => {
        if ('target' in node) {
            node.setAttribute('target', '_blank');
        }
    });
    self.DOMPurify && DOMPurify.addHook('afterSanitizeElements', (node) => {
        /* Remove empty <code> tags. */
        if (node.nodeName === 'CODE' && node.childNodes.length === 0) {
            node.parentNode.removeChild(node);
        }
    });

    /* Sends exception data to https://sentry.io */
    F.util.start_error_reporting = function() {
        if (forsta_env.SENTRY_DSN) {
            Raven.config(forsta_env.SENTRY_DSN, {
                release: forsta_env.GIT_COMMIT,
                serverName: forsta_env.SERVER_HOSTNAME,
                environment: 'dev'
            }).install();
        }
    };

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

    F.util.sleep = function(seconds) {
        return new Promise(r => setTimeout(r, seconds * 1000, seconds));
    };


    F.util.htmlSanitize = function(dirty_html_str) {
        return DOMPurify.sanitize(dirty_html_str, {
            ALLOW_ARIA_ATTR: false,
            ALLOW_DATA_ATTR: false,
            ALLOWED_TAGS: ['p', 'b', 'i', 'u', 'del', 'pre', 'code', 'br', 'hr',
                           'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                           'em', 'time', 'mark', 'blockquote', 'ul', 'ol', 'li',
                           'dd', 'dl', 'dt', 'a', 'abbr', 'cite', 'dfn', 'q',
                           'kbd', 'samp', 'small', 's', 'ins', 'strong', 'sub',
                           'sup', 'var', 'wbr', 'audio', 'img', 'video', 'source',
                           'blink'],
            ALLOWED_ATTR: ['src', 'type', 'controls', 'title', 'alt', 'checked',
                           'cite', 'color', 'background', 'border', 'bgcolor',
                           'autocomplete', 'align', 'action', 'accept', 'href',
                           'datetime', 'default', 'dir', 'disabled', 'face',
                           'for', 'headers', 'height', 'width', 'hidden', 'label',
                           'lang', 'max', 'maxlength', 'multiple', 'min',
                           'placeholder', 'readonly', 'role', 'spellcheck',
                           'selected', 'start', 'step', 'summary', 'value']
        });
    };

    const code_block = /```([\s\S]*?)```/g;
    const styles = {
        samp: /`(.+?)`/g,
        mark: /=(.+?)=/g,
        ins: /\+(.+?)\+/g,
        strong: /\*(.+?)\*/g,
        del: /~(.+?)~/g,
        u: /__(.+?)__/g,
        em: /_(.+?)_/g,
        sup: /\^(.+?)\^/g,
        sub: /\?(.+?)\?/g,
        blink: /!(.+?)!/g,
        q: /&gt;\s+(.+)/gm,
        h6: /#{6}\s*(.+)/gm,
        h5: /#{5}\s*(.+)/gm,
        h4: /#{4}\s*(.+)/gm,
        h3: /#{3}\s*(.+)/gm,
        h2: /#{2}\s*(.+)/gm,
        h1: /#{1}\s*(.+)/gm
    }

    F.util.forstadownConvert = function(fd_str) {
        const stack = [];

        /* Code is special for now. */
        let pos = 0;
        fd_str.replace(code_block, (outer, inner, offset, whole) => {
            if (pos - offset > 0) {
                stack.push({
                    protected: false,
                    value: whole.slice(pos, offset)
                });
            }
            pos = offset + outer.length;
            if (inner.length) {
                stack.push({
                    protected: true,
                    value: `<code>${inner}</code>`
                });
            }
        });
        if (!stack.length) {
            stack.push({
                protected: false,
                value: fd_str
            });
        }

        /* Do all the inline ones now */
        const buf = [];
        for (const segment of stack) {
            if (segment.protected) {
                buf.push(segment.value);
            } else {
                let val = segment.value;
                for (const tag in styles) {
                    val = val.replace(styles[tag], `<${tag}>$1</${tag}>`);
                }
                buf.push(val);
            }
        }
        return buf.join('');
    };
})();
