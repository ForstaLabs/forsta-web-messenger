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

   ns.theme_colors = [
        'red',
        'orange',
        'yellow',
        'olive',
        'green',
        'teal',
        'blue',
        'violet',
        'pink',
        'brown',
        'grey',
        'black'
    ];

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
                           'selected', 'start', 'step', 'summary', 'value']
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

    ns.gravatarURL = function(email, options) {
        const args = Object.assign({
            s: 128,
            r: 'pg',
            d: 'retro'
        }, options);
        const hash = md5(email.toLowerCase().trim());
        const q = ns.urlQuery(args);
        return `https://www.gravatar.com/avatar/${hash}${q}`;
    };

    ns.pickColor = function(hashable) {
        const intHash = parseInt(md5(hashable).substr(0, 10), 16);
        return ns.theme_colors[intHash % ns.theme_colors.length];
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
                        class: 'approve blue',
                        label: options.confirmLabel || 'Confirm'
                    }, {
                        class: 'deny black',
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
