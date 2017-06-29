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

    let viewDOMPurify;
    let fdDOMPurify;

    /*TODO: add hook to fdDOMPurify to traverse generated DOM from text input and
        run fdConvert() */
    if (self.DOMPurify) {
        viewDOMPurify = DOMPurify(self);
        fdDOMPurify = DOMPurify(self);
        
        const targetBlankHook = node => {
            if ('target' in node) {
                node.setAttribute('target', '_blank');
            }
        };
        viewDOMPurify.addHook('afterSanitizeAttributes', targetBlankHook);
        fdDOMPurify.addHook('afterSanitizeAttributes', targetBlankHook);
        fdDOMPurify.addHook('afterSanitizeElements', node => {
            console.info('nodeName: ', node.nodeName);
            if(node.nodeName === '#text' && node.parentNode.nodeName !== 'A') {
                console.info('nodeValue: ', node.nodeValue);
                const convertedVal = F.util.forstadownConvert(node.nodeValue);
                if(convertedVal !== node.nodeValue) {
                    const newNode = $.parseHTML(convertedVal)[0];
                    node.parentElement.replaceChild(newNode, node);
                } 
                console.info('newValue: ', node.nodeValue);
            }
        });
    }

    /* XXX This may no longer be necessary due to forstadownConvert */
    /*self.DOMPurify && DOMPurify.addHook('afterSanitizeElements', (node) => {
        Remove empty <code> tags. 
        if (node.nodeName === 'CODE' && node.childNodes.length === 0) {
            node.parentNode.removeChild(node);
        }
    });*/
 
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

    F.util.htmlSanitize = function(dirty_html_str, render_forstadown) {
        const purify = render_forstadown ? fdDOMPurify : viewDOMPurify;
        return purify.sanitize('<force/>' + dirty_html_str, {
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
    const a = /((https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)))(">(.*)<\/a>)?/ig;
    const already_html_link = /(<a href="http).+(<\/a>)/ig;
    const styles = {
        samp: /`(\S.*?\S|\S)`/g,
        mark: /==(\S.*?\S|\S)==/g,
        ins: /\+(\S.*?\S|\S)\+/g,
        strong: /\*(\S.*?\S|\S)\*/g,
        del: /~(\S.*?\S|\S)~/g,
        u: /__(\S.*?\S|\S)__/g,
        em: /_(\S.*?\S|\S)_/g,
        sup: /\^(\S.*?\S|\S)\^/g,
        sub: /\?(\S.*?\S|\S)\?/g,
        blink: /!(\S.*?\S|\S)!/g,
        // q: /&gt;\s+(\S.+)/gm,
        h1: /#{3}(\S.*?\S|\S)#{3}/gm,
        h3: /#{2}(\S.*?\S|\S)#{2}/gm,
        h5: /#{1}(\S.*?\S|\S)#{1}/gm
    }
  
    F.util.nodeTraverse = function(dirty_str) {
        const less_dirty = $.trim(dirty_str);
        let dom_doc = $.parseHTML(less_dirty);

    };

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
            } 
            else {
                let val = segment.value;
                for (const tag in styles) {
                    val = val.replace(styles[tag], `<${tag}>$1</${tag}>`);  
                }
                if(!val.match(already_html_link)) {
                    let url_val = val.match(a);
                    val = val.replace(a, `<a href=${url_val}>${url_val}</a>`);
                }
                buf.push(val);
            }
        }
        return buf.join('');
    };
})();
