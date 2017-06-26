/*
 * vim: ts=4:sw=4:expandtab
 */

;(function () {
    'use strict';

    window.F = window.F || {};
    F.util = {};
    F.urls = {
        main: '/@',
        login: '/login',
        logout: '/logout',
        static: '/@static/',
        install: '/@install',
        register: '/@register',
        templates: '/@static/templates/'
    }

    DOMPurify.addHook('afterSanitizeAttributes', node => {
        if ('target' in node) {
            node.setAttribute('target', '_blank');
        }
    });

    DOMPurify.addHook('afterSanitizeElements', (node) => {
        /* Remove empty <code> tags. */
        if (node.nodeName === 'CODE' && node.childNodes.length === 0) {
            node.parentNode.removeChild(node);
        }
    });


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

    const code_block = /```([\s\S]*?)```/gm;
    const a = /((https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)))(">(.*)<\/a>)?/gi;
    const styles = {
        samp: /`(\S.*?\S|\S)`/g,
        mark: /=(\S.*?\S|\S)=/g,
        ins: /\+(\S.*?\S|\S)\+/g,
        strong: /\*(\S.*?\S|\S)\*/g,
        del: /~(\S.*?\S|\S)~/g,
        u: /__(\S.*?\S|\S)__/g,
        em: /_(\S.*?\S|\S)_/g,
        sup: /\^(\S.*?\S|\S)\^/g,
        sub: /\?(\S.*?\S|\S)\?/g,
        blink: /!(\S.*?\S|\S)!/g,
        // q: /&gt;\s+(\S.+)/gm,
        h1: /#{3}(\S.*?)#{3}/gm,
        h3: /#{2}(\S.*?)#{2}/gm,
        h5: /#{1}(\S.*?)#{1}/gm
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
                let url_val = val.match(a)
                val = val.replace(a, `<a href=${url_val}>${url_val}</a>`);
                buf.push(val);
            }
        }
        return buf.join('');
    };
})();
