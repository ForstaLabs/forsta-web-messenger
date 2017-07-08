/*
 * vim: ts=4:sw=4:expandtab
 */

;(function () {
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

    let viewDOMPurify;
    let fdDOMPurify;

    if (self.DOMPurify) {
        viewDOMPurify = DOMPurify(self);
        fdDOMPurify = DOMPurify(self);
        
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

        viewDOMPurify.addHook('afterSanitizeAttributes', targetBlankHook);
        fdDOMPurify.addHook('afterSanitizeAttributes', targetBlankHook);
        fdDOMPurify.addHook('afterSanitizeElements', node => {
            if(node.nodeName === '#text' && !node._forsta_mark) {
                const convertedVal = ns.fdInlineConvert(node.nodeValue, parentNodes(node));
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
                environment: 'dev',
                tags: {
                    git_branch: forsta_env.GIT_BRANCH,
                    git_tag: forsta_env.GIT_TAG
                }
            }).install();
            addEventListener('error', _ => Raven.showReportDialog());
            /* For promise based exceptions... */
            addEventListener('unhandledrejection', ev => {
                const exc = ev.reason;  // This is the actual error instance.
                Raven.captureException(exc, {tags: {async: true}});
                Raven.showReportDialog();
            });
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
            dirty_html_str = ns.fdBlockConvert(dirty_html_str);
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

    const fdExpressions = [{
        tag: 'a',
        stop_on_match: true,
        match: /((https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)))(">(.*)<\/a>)?/ig,
        sub: '<a href="$1">$1</a>',
        parent_blacklist: ['a']
    }, {
        tag: 'samp',
        match: /`(\S.*?\S|\S)`/g
    }, {
        tag: 'mark',
        match: /=(\S.*?\S|\S)=/g
    }, {
        tag: 'ins',
        match: /\+(\S.*?\S|\S)\+/g
    }, {
        tag: 'strong',
        match: /\*(\S.*?\S|\S)\*/g
    }, {
        tag: 'del',
        match: /~(\S.*?\S|\S)~/g
    }, {
        tag: 'u',
        match: /__(\S.*?\S|\S)__/g
    }, {
        tag: 'em',
        match: /_(\S.*?\S|\S)_/g
    }, {
        tag: 'sup',
        match: /\^(\S.*?\S|\S)\^/g
    }, {
        tag: 'sub',
        match: /\?(\S.*?\S|\S)\?/g
    }, {
        tag: 'blink',
        match: /!(\S.*?\S|\S)!/g
    }, {
        tag: 'h1',
        match: /#{3}(.*?|\S)#{3}/gm
    }, {
        tag: 'h3',
        match: /#{2}(.*?|\S)#{2}/gm
    }, {
        tag: 'h5',
        match: /#{1}(.*?|\S)#{1}/gm
    }];
  
    ns.nodeTraverse = function(dirty_str) {
        const less_dirty = $.trim(dirty_str);
        let dom_doc = $.parseHTML(less_dirty);

    };

    ns.fdBlockConvert = function(html) {
        let open = false;
        return html.split(/(```)/).map(x => {
            if (x === '```') {
                open = !open;
                return open ? '<code>' : '</code>';
            } else {
                return x;
            }
        }).join('');
    };

    ns.fdInlineConvert = function(text, parent_nodes) {
        /* Do all the inline ones now */
        const parents = new Set(parent_nodes.map(x => x.nodeName.toLowerCase()));
        if (parents.has('code')) {
            return text;
        }
        let val = text;
        for (const expr of fdExpressions) {
            if (val.match(expr.match)) {
                if (expr.parent_blacklist &&
                    !!expr.parent_blacklist.filter(x => parents.has(x)).length) {
                    if (expr.stop_on_match) {
                        break;
                    } else {
                        continue;
                    }
                }
                const sub = expr.sub || `<${expr.tag}>$1</${expr.tag}>`;
                val = val.replace(expr.replace || expr.match, sub);
                if (expr.stop_on_match) {
                    break;
                }
            }
        }
        return val;
    };

    ns.tagParse = function(raw_expr) {
        return tagParser.parse(raw_expr);
    };

    ns.uuid4 = function() {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
    };
})();
