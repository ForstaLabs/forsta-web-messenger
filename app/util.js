// vim: ts=4:sw=4:expandtab
/* global Raven, DOMPurify, forstadown, md5 */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.util = {};

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

    ns.theme_colors = {
        red: '#db2828',
        orange: '#fa7d20',
        yellow: '#fbbd08',
        olive: '#b5cc18',
        green: '#21ba45',
        teal: '#00b5ad',
        blue: '#2185d0',
        violet: '#6435c9',
        pink: '#e03997',
        brown: '#a5673f',
        grey: '#767676',
        black: '#1b1c1d'
    };

    function targetBlankHook(node) {
        if ('target' in node) {
            node.setAttribute('target', '_blank');
        }
    }

    function makeFrag(html) {
        const frag = document.createDocumentFragment();
        const transfer = document.createElement('div');
        transfer.innerHTML = html;
        const nodes = transfer.childNodes;
        while (nodes.length) {
            const node = nodes[0];
            node._forsta_mark = true;
            frag.appendChild(node);
        }
        return frag;
    }

    function parentNodes(node) {
        const parents = [];
        let ptr = node.parentNode;
        while (ptr) {
            parents.push(ptr);
            ptr = ptr.parentNode;
        }
        return parents;
    }

    let viewDOMPurify;
    let fdDOMPurify;
    if (self.DOMPurify) {
        viewDOMPurify = DOMPurify(self);
        fdDOMPurify = DOMPurify(self);

        viewDOMPurify.addHook('afterSanitizeAttributes', targetBlankHook);
        fdDOMPurify.addHook('afterSanitizeAttributes', targetBlankHook);
        fdDOMPurify.addHook('afterSanitizeElements', node => {
            if(node.nodeName === '#text' && !node._forsta_mark) {
                const parentTags = new Set(parentNodes(node).map(x => x.nodeName.toLowerCase()));
                const convertedVal = forstadown.inlineConvert(node.nodeValue, parentTags);
                if (convertedVal !== node.nodeValue) {
                    node.parentElement.replaceChild(makeFrag(convertedVal), node);
                }
            }
        });
        fdDOMPurify.addHook('afterSanitizeElements', node => {
            /* Cleanup mess left by our crufty code tag insertion */
            if (node.nodeName === 'CODE' && node.childNodes.length === 0) {
                node.parentNode.removeChild(node);
            }
        });
    }

    /* Sends exception data to https://sentry.io and get optional user feedback. */
    ns.start_error_reporting = function() {
        if (forsta_env.SENTRY_DSN) {
            Raven.config(forsta_env.SENTRY_DSN, {
                release: forsta_env.GIT_COMMIT,
                serverName: forsta_env.SERVER_HOSTNAME,
                environment: forsta_env.STACK_ENV || 'dev'
            }).install();
            if (forsta_env.SENTRY_USER_ERROR_FORM) {
                addEventListener('error', () => Raven.showReportDialog());
                /* For promise based exceptions... */
                addEventListener('unhandledrejection', ev => {
                    const exc = ev.reason;  // This is the actual error instance.
                    Raven.captureException(exc, {tags: {async: true}});
                    Raven.showReportDialog();
                });
            }
        }
    };

    /* Emulate Python's asyncio.as_completed */
    ns.as_completed = function*(promises) {
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

    ns.sleep = function(seconds) {
        return new Promise(r => setTimeout(r, seconds * 1000, seconds));
    };

    ns.htmlSanitize = function(dirty_html_str, render_forstadown) {
        if (!dirty_html_str) {
            return dirty_html_str;
        }
        const purify = render_forstadown ? fdDOMPurify : viewDOMPurify;
        if (render_forstadown) {
            dirty_html_str = forstadown.blockConvert(dirty_html_str);
        }
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
                           'selected', 'start', 'step', 'summary', 'value',
                           'controls', 'loop', 'autoplay', 'muted', 'poster',
                           'preload']
        });
    };

    ns.uuid4 = function() {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
    };

    /* Extend the builtin Set type with intersection methods. */
    ns.ESet = class ESet extends Set {
        isSuperset(subset) {
            for (const elem of subset) {
                if (!this.has(elem)) {
                    return false;
                }
            }
            return true;
        }

        union(setB) {
            const union = new ESet(this);
            for (const elem of setB) {
                union.add(elem);
            }
            return union;
        }

        intersection(setB) {
            const intersection = new ESet();
            for (const elem of setB) {
                if (this.has(elem)) {
                    intersection.add(elem);
                }
            }
            return intersection;
        }

        difference(setB) {
            const difference = new ESet(this);
            for (const elem of setB) {
                difference.delete(elem);
            }
            return difference;
        }

        equals(setB) {
            return this.size === setB.size && !this.difference(setB).size;
        }
    };

    ns.urlQuery = function(args_dict) {
        /* Convert the args dict to a url query string or empty string. */
        if (!args_dict) {
            return '';
        }
        const args = Object.keys(args_dict).map(x =>
            `${encodeURIComponent(x)}=${encodeURIComponent(args_dict[x])}`);
        return '?' + args.join('&');
    };

    const _gravatarCache = new Map();
    ns.gravatarURL = async function(email, options) {
        const args = Object.assign({
            size: 128,
            rating: 'pg'
        }, options);
        args.default = 404;
        const hash = md5(email.toLowerCase().trim());
        const q = ns.urlQuery(args);
        const key = JSON.stringify(Object.entries(args).sort()) + email;
        if (!_gravatarCache.has(key)) {
            const resp = await fetch(`https://www.gravatar.com/avatar/${hash}${q}`);
            let url;
            if (!resp.ok) {
                console.assert(resp.status === 404);
            } else {
                url = URL.createObjectURL(await resp.blob());
            }
            _gravatarCache.set(key, url);
        }
        return _gravatarCache.get(key);
    };

    const _textAvatarCache = new Map();
    ns.textAvatar = async function(text, color) {
        color = color || F.util.pickColor(text);
        const colorHex = ns.theme_colors[color];
        const key = JSON.stringify([text, color]);
        if (!_textAvatarCache.has(key)) {
            const svg = [
                '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">',
                    `<circle cx="64" cy="64" r="63" fill="${colorHex}"/>`,
                    '<text text-anchor="middle" fill="white" font-size="64" x="64" y="64" ',
                          'font-family="Arial" baseline-shift="-21px">',
                        text,
                    '</text>',
                '</svg>'
            ];
            const blob = new Blob(svg, {type: 'image/svg+xml'});
            const url = URL.createObjectURL(blob);
            _textAvatarCache.set(key, url);
        }
        return _textAvatarCache.get(key);
    };

    ns.pickColor = function(hashable) {
        const intHash = parseInt(md5(hashable).substr(0, 10), 16);
        const colors = Object.keys(ns.theme_colors);
        return colors[intHash % colors.length];
    };

    ns.confirmModal = async function(options) {
        let view;
        const p = new Promise((resolve, reject) => {
            try {
                view = new F.ModalView({
                    header: options.header,
                    content: options.content,
                    icon: options.icon,
                    actions: [{
                        class: 'approve blue ' + options.confirmClass,
                        label: options.confirmLabel || 'Confirm'
                    }, {
                        class: 'deny black ' + options.cancelClass,
                        label: options.cancelLabel || 'Cancel'
                    }],
                    options: {
                        onApprove: () => resolve(true),
                        onDeny: () => resolve(false),
                        onHide: () => resolve(undefined)
                    }
                });
            } catch(e) {
                reject(e);
            }
        });
        await view.show();
        return await p;
    };
})();
