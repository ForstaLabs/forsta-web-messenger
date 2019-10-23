// vim: ts=4:sw=4:expandtab
/* global Raven, DOMPurify, forstadown, md5, ga, loadImage mnemonic relay */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.util = {};

    const logger = F.log.getLogger('util');

    const googleMapsKey = F.env.GOOGLE_MAPS_API_KEY;
    const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    const hasAvatarService = !!F.env.HAS_AVATAR_SERVICE;

    F.urls = {
        main: '/@',
        signin: '/login',
        static: '/@static/',
        install: '/@install',
        register: '/@register',
        templates: '/@static/templates/',
        worker_service: '/@worker-service.js',
        worker_shared: '/@worker-shared.js',
        zendeskArticles: 'https://forsta.zendesk.com/api/v2/help_center/en-us/articles'
    };

    ns.bench = function(func, logEvery) {
        logEvery = logEvery || 10;
        let timer = 0;
        let count = 0;
        return async function() {
            const start = performance.now();
            try {
                return await func.apply(this, arguments);
            } finally {
                timer += performance.now() - start;
                count++;
                if (!(count % logEvery)) {
                    logger.info(`BENCH ${func.name || 'anonymous'} total_ms:${timer}, count:${count}, ` +
                                `avg_per_call:${timer/count}`);
                }
            }
        };
    };

    ns.themeColors = {
        red: '#db2828',
        deep_red: '#851313',
        orange: '#fa7d20',
        yellow: '#fbbd08',
        olive: '#b5cc18',
        green: '#21ba45',
        light_green: '#6dcb84',
        dark_green: '#284d14',
        teal: '#00b5ad',
        blue: '#2185d0',
        light_blue: '#4b84bc',
        dark_blue: '#074483',
        violet: '#6435c9',
        pink: '#e03997',
        brown: '#a5673f',
        grey: '#767676',
        black: '#3a3b3d'
    };

    // Device independent pixels (they are scaled for each device).
    ns.avatarDIPSizes = {
        small: 24,   // Based on group nav avatar
        medium: 48,  // Based on single nav avatar
        large: 256   // Based on modal user card avatar
    };

    function getAvatarPixels(size) {
        if (!size) {
            size = 'medium';
        }
        let pixels;
        if (typeof size === 'string') {
            pixels = ns.avatarDIPSizes[size];
            F.assert(pixels);
        } else {
            F.assert(typeof size === 'number');
            pixels = size;
        }
        return Math.round(pixels * (self.devicePixelRatio || 1));
    }

    function targetBlankHook(node) {
        if ('target' in node) {
            node.setAttribute('target', '_blank');
        }
    }

    function makeFrag(value, options) {
        const frag = document.createDocumentFragment();
        const transfer = document.createElement('div');
        transfer.innerHTML = value;
        const nodes = transfer.childNodes;
        while (nodes.length) {
            const node = nodes[0];
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
            if (node.nodeName === '#text') {
                const parents = parentNodes(node);
                // Prevent double conversion.  NodeIterator will call us with elements
                // we just created but forstadown is already recursive.
                if (parents.some(n => n._fdMark)) {
                    return;
                }
                const parentTags = new Set(parentNodes(node).map(x => x.nodeName.toLowerCase()));
                const convertedVal = forstadown.inlineConvert(node.nodeValue, parentTags);
                if (convertedVal !== node.nodeValue) {
                    const frag = makeFrag(convertedVal);
                    Array.from(frag.childNodes).map(n => n._fdMark = true);
                    node.parentElement.replaceChild(frag, node);
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

    const _issueEventHandlers = {};
    const _issueEventQueues = {};
    function initIssueReporting() {
        /* There are restrictions on when some event handlers can register in service
         * workers. Also, we'd like to capture any errors that happen early in the
         * start process if possible.
         */
        if (!F.env.SENTRY_DSN) {
            return;
        }
        for (const eventName of ['error', 'unhandledrejection']) {
            const q = _issueEventQueues[eventName] = [];
            addEventListener(eventName, ev => {
                const handler = _issueEventHandlers[eventName];
                if (handler) {
                    handler(ev);
                } else {
                    logger.warn("Enqueing early issue event:", eventName, ev);
                    q.push(ev);
                }
            });
        }
    }

    function addIssueHandler(eventName, handler) {
        const q = _issueEventQueues[eventName];
        for (const ev of q) {
            try {
                logger.info("Dequeing early issue event:", eventName, ev);
                handler(ev);
            } catch(e) {
                logger.error(e);
            }
        }
        q.length = 0;
        _issueEventHandlers[eventName] = handler;
    }

    let _issueReportingEnabled;
    ns.startIssueReporting = async function() {
        // Sends exception data to https://sentry.io and get optional user feedback.
        _issueReportingEnabled = !(await F.state.get('disableBugReporting'));
        if (_issueReportingEnabled && F.env.SENTRY_DSN && self.Raven) {
            Raven.config(F.env.SENTRY_DSN, {
                release: F.env.GIT_COMMIT,
                serverName: F.env.SERVER_HOSTNAME,
                environment: F.env.STACK_ENV || 'dev',
                tags: {
                    version: F.version
                }
            }).install();
            if (F.env.SENTRY_USER_ERROR_FORM) {
                addIssueHandler('error', () => {
                    if (_issueReportingEnabled) {
                        Raven.showReportDialog();
                    }
                });
            }
            /* For promise based exceptions... */
            addIssueHandler('unhandledrejection', ev => {
                if (_issueReportingEnabled) {
                    const exc = ev.reason;  // This is the actual error instance.
                    Raven.captureException(exc, {tags: {async: true}});
                    if (F.env.SENTRY_USER_ERROR_FORM) {
                        Raven.showReportDialog();
                    }
                }
            });
        }
    };

    ns.stopIssueReporting = function() {
        _issueReportingEnabled = false;
        Raven.uninstall();
    };

    ns.setIssueReportingContext = function(context) {
        self.Raven && Raven.setUserContext(context);
    };

    ns.reportIssue = function(level, msg, extra) {
        const logFunc = {
            warning: logger.warn,
            error: logger.error,
            info: logger.info
        }[level] || logger.log;
        logFunc.call(logger, msg, extra);
        if (_issueReportingEnabled && self.Raven) {
            Raven.captureMessage(msg, {
                level,
                extra
            });
        }
    };

    ns.reportError = function(msg, extra) {
        ns.reportIssue('error', msg, extra);
    };

    ns.reportWarning = function(msg, extra) {
        ns.reportIssue('warning', msg, extra);
    };

    ns.reportInfo = function(msg, extra) {
        ns.reportIssue('info', msg, extra);
    };

    let _usageReportingEnabled;
    ns.startUsageReporting = async function() {
        _usageReportingEnabled = !(await F.state.get('disableUsageReporting')) &&
                                 !!F.env.GOOGLE_ANALYTICS_UA;
        if (_usageReportingEnabled) {
            ga('create', F.env.GOOGLE_ANALYTICS_UA, 'auto');
            ga('set', 'anonymizeIp', true);
            ga('set', 'userId', md5(F.currentUser.id));
            ga('send', 'pageview');
        }
    };

    ns.stopUsageReporting = function() {
        if (_usageReportingEnabled) {
            _usageReportingEnabled = false;
            ga('remove');
        }
    };

    ns.reportUsageCommand = function() {
        if (_usageReportingEnabled) {
            ga.apply(self, arguments);
        }
    };

    ns.reportUsageEvent = function() {
        const args = ['send', 'event'].concat(Array.from(arguments));
        ns.reportUsageCommand.apply(this, args);
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
                           'preload', 'disableRemotePlayback', 'playsinline', 'f-type',
                           'style', 'contenteditable']
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

    ns.urlQuery = function(args) {
        /* Convert the args object to a url query string or empty string. */
        if (!args) {
            return '';
        }
        const pruned = Object.entries(args).filter(([_, val]) => val != null);
        if (!pruned.length) {
            return '';
        }
        const encoded = pruned.map(tuple => tuple.map(encodeURIComponent).join('='));
        return '?' + encoded.join('&');
    };

    ns.blobToDataURL = async function(blob) {
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener('load', () => resolve(reader.result));
            reader.addEventListener('error', reject);
            reader.readAsDataURL(blob);
        });
    };

    async function avatarFetch(urn, options) {
        options = options || {};
        const fetchOptions = {};
        if (!options.skipAuth) {
            fetchOptions.headers = {Authorization: `JWT ${await relay.hub.getEncodedAtlasToken()}`};
        }
        return await fetch(`${F.env.ATLAS_AVATAR_URL}${urn}`, fetchOptions);
    }

    ns.gravatarURL_ORIG = F.cache.ttl(86400 * 7, async function util_gravatarURL(hash, options) {
        options = options || {};
        const args = Object.assign({
            rating: 'pg',
            _dc: Math.floor(Date.now() / 86400000) // Bust gravatar caches once a day.
        }, options);
        args.size = getAvatarPixels(options.size),
        args.default = 404;
        const q = ns.urlQuery(args);
        // NOTE: `www.gravatar.com` has some bugs that cause it to return 503 sometimes.
        // I contacted the directly and they recommended we use `en.gravatar.com`.
        const resp = await fetch(`https://en.gravatar.com/avatar/${hash}${q}`);
        if (!resp.ok) {
            if (resp.status !== 404) {
                throw new Error(await resp.text());
            } else {
                return;
            }
        }
        return await ns.blobToDataURL(await resp.blob());
    }, {store: 'shared_db'});

    ns.gravatarURL_SERVICE = F.cache.ttl(86400, async function util_gravatarURL(hash, options) {
        const args = Object.assign({
            devicePixelRatio: self.devicePixelRatio,
        }, options);
        const q = ns.urlQuery(args);
        const resp = await avatarFetch(`/avatar/gravatar/${hash}${q}`, {skipAuth: true});
        if (!resp.ok) {
            if (resp.status !== 404) {
                throw new Error(await resp.text());
            } else {
                return;
            }
        }
        return await ns.blobToDataURL(await resp.blob());
    }, {store: 'shared_db'});

    ns.gravatarURL = hasAvatarService ? ns.gravatarURL_SERVICE : ns.gravatarURL_ORIG;

    let _fontURL;
    const _textAvatarURL_ORIG = F.cache.ttl(86400 * 120, async function util_textAvatarURL(text, bgColor, fgColor, options) {
        options = options || {};
        bgColor = bgColor || ns.pickColor(text);
        bgColor = ns.themeColors[bgColor] || bgColor;
        fgColor = fgColor || 'white';
        fgColor = ns.themeColors[fgColor] || fgColor;
        if (!_fontURL) {
            const fontBlob = await ns.fetchStaticBlob('fonts/Poppins-Medium.ttf');
            _fontURL = await ns.blobToDataURL(fontBlob);
        }
        const size = getAvatarPixels(options.size);
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
                <defs>
                    <style type="text/css">
                        @font-face {
                            font-family: 'ForstaAvatar';
                            src: url(${_fontURL}) format('truetype');
                        }
                    </style>
                    <linearGradient id="gradient" x1="0" y1="0" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color: rgb(0, 0, 0); stop-opacity: 0;" />
                        <stop offset="100%" style="stop-color: rgb(0, 0, 0); stop-opacity: 0.20" />
                    </linearGradient>
                </defs>
                <rect width="${size}" height="${size}" fill="${bgColor}"/>
                <rect width="${size}" height="${size}" fill="url(#gradient)"/>
                <text text-anchor="middle" fill="${fgColor}" font-size="${size / 2.5}" x="${size / 2}" y="${size / 2}"
                      font-family="ForstaAvatar" dominant-baseline="central">${text}</text>
            </svg>
        `;
        const img = new Image();
        const getPngUrl = new Promise((resolve, reject) => {
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.height = canvas.width = size;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    resolve(canvas.toDataURL('image/png'));
                } catch(e) {
                    reject(e);
                }
            };
            img.onerror = reject;
        });
        img.src = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
        try {
            return await getPngUrl;
        } finally {
            URL.revokeObjectURL(img.src);
        }
    }, {store: 'shared_db'});

    const _textAvatarURL_SERVICE = F.cache.ttl(86400 * 120, async function util_textAvatarURL(text, bgColor, fgColor, options) {
        const args = Object.assign({
            devicePixelRatio: self.devicePixelRatio,
            fgColor,
            bgColor,
        }, options);
        const q = ns.urlQuery(args);
        const resp = await avatarFetch(`/avatar/text/${text}${q}`, {skipAuth: true});
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        return await ns.blobToDataURL(await resp.blob());
    }, {store: 'shared_db'});

    ns.textAvatarURL = async function() {
        if (hasAvatarService) {
            return await _textAvatarURL_SERVICE.apply(this, arguments);
        } else if (!self.Image) {
            /* Probably a service worker. */
            return ns.versionedURL(F.urls.static + 'images/simple_user_avatar.png');
        } else {
            return await _textAvatarURL_ORIG.apply(this, arguments);
        }
    };

    ns.userAvatarURL = F.cache.ttl(86400, async function util_userAvatarURL(id, options) {
        const args = Object.assign({
            devicePixelRatio: self.devicePixelRatio,
        }, options);
        const q = ns.urlQuery(args);
        const resp = await avatarFetch(`/avatar/user/${id}${q}`);
        if (!resp.ok) {
            if (resp.status === 404) {
                logger.warn("User avatar not found for:", id);
                return;
            } else {
                throw new Error(await resp.text());
            }
        }
        return await ns.blobToDataURL(await resp.blob());
    }, {store: 'shared_db'});

    ns.pickColor = function(hashable, hex) {
        const intHash = parseInt(md5(hashable).substr(0, 10), 16);
        const colors = Object.keys(ns.themeColors);
        const label = colors[intHash % colors.length];
        return hex ? ns.themeColors[label] : label;
    };

    ns.confirmModal = function(options) {
        const viewOptions = Object.assign({
            icon: 'help circle',
            dismissLabel: 'Dismiss',
            dismissClass: '',
            confirmLabel: 'Confirm',
            confirmClass: 'primary',
            actions: []
        }, options);
        if (viewOptions.dismiss !== false) {
            viewOptions.actions.push({
                class: 'deny ' + viewOptions.dismissClass,
                label: viewOptions.dismissLabel,
                icon: viewOptions.dismissIcon
            });
        }
        if (viewOptions.confirm !== false) {
            viewOptions.actions.push({
                class: 'approve ' + viewOptions.confirmClass,
                label: viewOptions.confirmLabel,
                icon: viewOptions.confirmIcon
            });
        }
        let view;
        const p = new Promise((resolve, reject) => {
            viewOptions.modalOptions = Object.assign({
                onApprove: () => resolve(true),
                onDeny: () => resolve(false),
                onHide: () => resolve(undefined),
            }, options.modalOptions);
            view = new F.ModalView(viewOptions);
            view.show().catch(reject);
        });
        p.view = view;
        return p;
    };

    ns.promptModal = function(options) {
        const viewOptions = Object.assign({
            icon: 'info circle',
        }, options);
        if (options.dismiss === false) {
            if (options.actions) {
                throw new TypeError("Options `actions` and `dismiss` are mutually exclusive");
            }
            viewOptions.actions = [];  // Clober defaults to remove dismiss action.
        }
        let view;
        const p = new Promise((resolve, reject) => {
            viewOptions.modalOptions = Object.assign({
                onApprove: () => resolve(true),
                onHide: () => resolve(undefined),
            }, options.modalOptions);
            view = new F.ModalView(viewOptions);
            view.show().catch(reject);
        });
        p.view = view;
        return p;
    };

    ns.formModal = function(options) {
        const fields = [];
        for (const x of options.fields) {
            fields.push(`
                <div class="field">
                    <label>${x.label}</label>
                    <input type="${x.inputType || 'text'}"
                           name="${x.name}"
                           placeholder="${x.placeholder || ''}"/>
                </div>
            `.trim());
        }
        const viewOptions = Object.assign({
            icon: 'question circle',
            dismissLabel: 'Dismiss',
            dismissClass: '',
            confirmLabel: 'Submit',
            confirmClass: 'primary',
            actions: [],
            content: `
                <div class="ui form">
                    ${fields.join('')}
                    <div class="ui error message"></div>
                </div>
            `
        }, options);
        if (viewOptions.dismiss !== false) {
            viewOptions.actions.push({
                class: 'deny ' + viewOptions.dismissClass,
                label: viewOptions.dismissLabel,
                icon: viewOptions.dismissIcon
            });
        }
        if (viewOptions.confirm !== false) {
            viewOptions.actions.push({
                class: 'approve ' + viewOptions.confirmClass,
                label: viewOptions.confirmLabel,
                icon: viewOptions.confirmIcon
            });
        }
        let view;
        const p = new Promise((resolve, reject) => {
            viewOptions.modalOptions = Object.assign({
                onApprove: () => resolve(view.$('.ui.form').form('get values')),
                onHide: () => resolve(undefined),
            }, options.modalOptions);
            view = new F.ModalView(viewOptions);
            view.on('render', () => {
                const $form = view.$('.ui.form');
                $form.form();
                $form.on('submit', () => view.$el.modal('event approve'));
            });
            view.show().catch(reject);
        });
        p.view = view;
        return p;
    };

    ns.isSmallScreen = function() {
        // Make max-width matches stylesheets/main.scss @media for small screen
        return matchMedia('(max-width: 768px)').matches;
    };

    ns.isTouchDevice = function() {
        return !!('ontouchstart' in self || navigator.maxTouchPoints);
    };

    ns.isCoarsePointer = function() {
        // This is a useful way to detect if the device doesn't have a real mouse.
        return matchMedia('(pointer: coarse)').matches;
    };

    if (self.jQuery && ns.isCoarsePointer()) {
        // We need to leave a breadcrumb for lesser browsers like gecko.
        // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1035774
        $('html').addClass('f-coarse-pointer');
    }

    const _audioBufferCache = new Map();
    let _audioCtx;
    let _startAudioContext;
    function initAudioContext() {
        // Gestures that are allowed to setup audio (subject to change).
        const events = ['mousedown', 'mouseup',
                        'pointerdown', 'pointerup',
                        'touchstart', 'touchend',
                        'click', 'dblclick', 'contextmenu', 'auxclick',
                        'keydown', 'keyup'];
         _startAudioContext = async () => {
            if (_audioCtx && _audioCtx.state !== 'suspended') {
                return;
            }
            const AudioCtx = self.AudioContext || self.webkitAudioContext;
            if (!AudioCtx) {
                return;
            }
            const ctx = new AudioCtx();
            if (ctx.state === 'suspended') {
                // Chrome tends to start life "running" but FF needs a nudge...
                try {
                    // HACK: See missing `document.autoplayPolicy`
                    const timeout = 0.200;
                    if (await Promise.race([F.sleep(timeout), ctx.resume()]) === timeout) {
                        logger.debug("Audio context could not be resumed: TIMEOUT");
                    }
                } catch(e) {
                    logger.debug("Audio context could not be resumed:", e);
                }
            }
            if (ctx.state !== 'suspended') {
                logger.info("Audio playback enabled");
                _audioCtx = ctx;
                for (const ev of events) {
                    document.removeEventListener(ev, _startAudioContext);
                }
            }
        };
        for (const ev of events) {
            document.addEventListener(ev, _startAudioContext);
        }
    }

    ns.playAudio = async function(url, options) {
        options = options || {};
        const dummy = {
            stop: () => undefined,
            ended: Promise.resolve()
        };
        if (!self.document) {
            return dummy;
        }
        await _startAudioContext();
        if (!_audioCtx) {
            return dummy;
        }
        F.assert(_audioCtx.state !== 'suspended');
        const source = _audioCtx.createBufferSource();
        if (!_audioBufferCache.has(url)) {
            // Always use copy of the arraybuffer as it gets detached.
            const ab = (await ns.fetchStaticArrayBuffer(url)).slice(0);
            let buf;
            try {
                buf = await new Promise((resolve, reject) => {
                    _audioCtx.decodeAudioData(ab, resolve, reject);
                });
            } catch(e) {
                logger.error("Could not load audio data:", e);
                return dummy;
            }
            _audioBufferCache.set(url, buf);
        }
        source.buffer = _audioBufferCache.get(url);
        source.connect(_audioCtx.destination);
        if (options.loop) {
            source.loop = true;
        }
        source.start(0);
        return {
            stop: () => {
                try {
                    source.stop(0);
                } catch(e) {
                    // We really don't care very much...
                    logger.debug("Audio playback stop error:", e);
                }
            },
            ended: new Promise(resolve => {
                source.addEventListener('ended', () => {
                    source.disconnect(_audioCtx.destination);
                    resolve();
                });
            })
        };
    };

    ns.versionedURL = function(url) {
        url = url.trim();
        url += ((url.match(/\?/)) ? '&' : '?');
        url += 'v=' + F.env.GIT_COMMIT.substring(0, 8);
        return url;
    };

    const fetchStatic = F.cache.ttl(86400 * 30, async function util_fetchStatic(urn, options) {
        urn = ns.versionedURL(urn);
        const resp = await fetch(F.urls.static + urn.replace(/^\//, ''), options);
        if (!resp.ok) {
            throw new TypeError("Invalid fetch status: " + resp.status);
        }
        /* Return a Response-like object that can be stored in indexeddb */
        return {
            type: resp.headers.get('content-type'),
            status: resp.status,
            arrayBuffer: await resp.arrayBuffer()
        };
    }, {store: 'shared_db'});

    ns.fetchStaticArrayBuffer = async function(urn, options) {
        const respLike = await fetchStatic(urn, options);
        return respLike.arrayBuffer;
    };

    ns.fetchStaticBlob = async function(urn, options) {
        const respLike = await fetchStatic(urn, options);
        return new Blob([respLike.arrayBuffer], {type: respLike.type});
    };

    ns.fetchStaticJSON = async function(urn, options) {
        const respLike = await fetchStatic(urn, options);
        return JSON.parse(new TextDecoder('utf8').decode(new DataView(respLike.arrayBuffer)));
    };

    ns.resetRegistration = async function() {
        logger.warn("Clearing registration state");
        await F.state.put('registered', false);
        location.reload(); // Let auto-provision have another go.
        // location.reload is async, prevent further execution...
        await F.never();
    };

    ns.makeInvalidUser = function(label) {
        const user = new F.User({
            id: null,
            first_name: 'Invalid User',
            last_name: `(${label})`,
            email: 'support@forsta.io',
            gravatar_hash: 'ec055ce3445bb52d3e972f8447b07a68',
            tag: {
                id: null
            }
        });
        user.getColor = () => 'red';
        user.getAvatarURL = () => ns.textAvatarURL('⚠', user.getColor());
        return user;
    };

    async function idbRequest(req) {
        /* Convert IDBRequest object into a promise */
        return await new Promise((resolve, reject) => {
            req.onsuccess = ev => resolve(ev.target.result);
            req.onerror = ev => reject(ev.target.error);
        });
    }

    ns.dbStoreCount = async function(dbId, storeName, options) {
        options = options || {};
        if (F.managedConfig) {
            return await F.parentRPC.invokeCommand(`db-gateway-count-${dbId}`, {
                storeName,
                index: options.index,
                bound: options.bound,
            });
        } else {
            const db = await idbRequest(indexedDB.open(dbId));
            const tx = db.transaction(storeName);
            const store = tx.objectStore(storeName);
            if (options.index) {
                const index = store.index(options.index);
                const bounds = IDBKeyRange.bound(options.bound.lower, options.bound.upper,
                                                 options.bound.lowerOpen, options.bound.upperOpen);
                return await idbRequest(index.count(bounds));
            } else {
                return await idbRequest(store.count());
            }
        }
    };

    ns.dbStoreClear = async function(dbId, storeName) {
        if (F.managedConfig) {
            await F.parentRPC.invokeCommand(`db-gateway-clear-${dbId}`, {storeName});
        } else {
            const db = await idbRequest(indexedDB.open(dbId));
            await new Promise((resolve, reject) => {
                const tx = db.transaction('cache', 'readwrite');
                const store = tx.objectStore('cache');
                const req = store.clear();
                req.onerror = ev => reject(ev.target.error);
                tx.onerror = ev => reject(ev.target.error);
                tx.oncomplete = ev => resolve();
            });
        }
    };

    ns.dbStoreNames = async function(dbId) {
        if (F.managedConfig) {
            return await F.parentRPC.invokeCommand(`db-gateway-object-store-names-${dbId}`);
        } else {
            const db = await idbRequest(indexedDB.open(dbId));
            return Array.from(db.objectStoreNames);
        }
    };

    ns.online = async function(timeout) {
        if (navigator.onLine) {
            return;
        }
        await new Promise(resolve => {
            let timeoutId;
            const singleResolve = () => {
                resolve(navigator.onLine);
                removeEventListener('online', singleResolve);
                clearTimeout(timeoutId);
            };
            addEventListener('online', singleResolve);
            if (timeout) {
                timeoutId = setTimeout(singleResolve, timeout * 1000);
            }
        });
    };

    ns.visible = async function(timeout) {
        if (!document.hidden) {
            return;
        }
        await new Promise(resolve => {
            let timeoutId;
            const singleResolve = (ev, isTimeout) => {
                const visible = !document.hidden;
                if (visible || isTimeout) {
                    resolve(visible);
                    document.removeEventListener('visibilitychange', singleResolve);
                    clearTimeout(timeoutId);
                }
            };
            document.addEventListener('visibilitychange', singleResolve);
            if (timeout) {
                setTimeout(singleResolve, timeout * 1000, null, /*isTimeout*/ true);
            }
        });
    };

    ns.animationFrame = async function() {
        await new Promise(resolve => requestAnimationFrame(resolve));
    };

    if (self.requestIdleCallback) {
        ns.idle = async function() {
            await new Promise(resolve => requestIdleCallback(resolve));
        };
    } else {
        ns.idle = async function() {
            await F.sleep(Math.random());
        };
    }

    ns.callSoon = function(callback, args) {
        // Run callback in a future event loop iteration.
        // Note that this will likely cause 4ms latency, so do not use for
        // performance sensitive code.
        setTimeout(() => callback.apply(null, args), 0);
    };

    ns.showUserCard = async function(id, options) {
        options = options || {};
        const user = await F.atlas.getContact(id);
        if (!user) {
            throw new ReferenceError("User not found: card broken");
        }
        options.model = user;
        await (new F.UserCardView(options)).show();
    };

    ns.showTagCard = async function(id, options) {
        options = options || {};
        const tag = await F.atlas.getTag(id);
        const user = tag.get('user');  // Only on direct user tags.
        if (user) {
            const model = await F.atlas.getContact(user.id);
            await (new F.UserCardView({model})).show();
        } else {
            const anchorEl = options.anchorEl;
            await (new F.TagCardView({anchorEl, tag, autoRemove: true})).show();
        }
    };

    ns.showZendeskCard = async function(article, options) {
        options = options || {};
        const anchorEl = options.anchorEl;
        await (new F.ZendeskCardView({anchorEl, article, autoRemove: true})).show();
    };

    ns.DefaultMap = class DefaultMap extends Map {
        constructor(factory, iterable) {
            super(iterable);
            this._factory = factory;
        }

        get(key) {
            if (!this.has(key)) {
                this.set(key, this._factory());
            }
            return super.get(key);
        }
    };

    ns.syncContentHistory = async function(options) {
        options = options || {};
        const sync = new F.sync.Request();
        if (!options.silent) {
            const $statusNag = $('#f-sync-request');
            const $statusMsg = $statusNag.find('.f-msg');
            const hideNag = () => $statusNag.nag('hide');
            let started;
            let hideTimeout;
            sync.on('response', ev => {
                const stats = ev.request.stats;
                $statusMsg.html(`Synchronized ${stats.messages} messages, ` +
                    `${stats.threads} threads and ${stats.contacts} contacts.`);
                $statusNag.nag('show');
                clearTimeout(hideTimeout);
                hideTimeout = setTimeout(hideNag, Math.max(60000, Date.now() - started));
            });
            sync.on('starting', () => {
                $statusMsg.html('Synchronizing history - Scanning local database...');
                $statusNag.nag({persist: true});
            });
            sync.on('started', () => {
                const deviceCount = sync.devices.length;
                const countStmt = deviceCount === 1 ? '1 device' : `${deviceCount} devices`;
                $statusMsg.html(`Synchronizing history - Waiting for ${countStmt}...`);
                started = Date.now();
                hideTimeout = setTimeout(hideNag, 120 * 1000);
            });
        }
        const onResponse = F.buffered(async argsQueue => {
            // We need to refresh rendered message-list-views so they reflect the current
            // updated messages.
            const allThreads = new Set();
            for (const args of argsQueue) {
                const ev = args[0];
                for (const id of ev.updated.threads) {
                    allThreads.add(id);
                }
            }
            for (const id of allThreads) {
                const view = F.mainView.getThreadView(id);
                if (view) {
                    view.model.messages.reset();
                    await view.model.messages.fetchPage();
                }
            }
        }, 10000);
        sync.on('response', ev => (onResponse(ev), /*prevent await of buffered func*/ undefined));
        await F.state.put('lastSync', Date.now());
        await sync.syncContentHistory(options);
        return sync;
    };

    ns.getImage = async function(url) {
        const img = new Image();
        const done = new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });
        img.src = url;
        await done;
        return img;
    };

    ns.amplifyImageColor = async function(image, red, green, blue) {
        const canvas = document.createElement('canvas');
        canvas.setAttribute('width', image.width);
        canvas.setAttribute('height', image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, image.width, image.height);
        const data = ctx.getImageData(0, 0, image.width, image.height);
        for (let i = 0; i < data.data.length; i += 4) {
            if (red) {
                data.data[i] = Math.min(255, data.data[i] * red);
            }
            if (green) {
                data.data[i + 1] = Math.min(255, data.data[i + 1] * green);
            }
            if (blue) {
                data.data[i + 2] = Math.min(255, data.data[i + 2] * blue);
            }
        }
        ctx.putImageData(data, 0, 0);
        return await ns.getImage(canvas.toDataURL());
    };

    ns.reverseGeocode = F.cache.ttl(86400 * 30, async function util_reverseGeocode(lat, lng, types) {
        const geocode = {};
        if (!googleMapsKey) {
            logger.warn('Geocode disabled: google maps api key missing');
            return geocode;
        }
        const q = ns.urlQuery({
            latlng: [lat, lng].join(),
            key: googleMapsKey,
            result_type: (types || [
                'street_address',
                'locality'
            ]).join('|')
        });
        const resp = await fetch('https://maps.googleapis.com/maps/api/geocode/json' + q);
        for (const res of (await resp.json()).results) {
            for (const type of res.types) {
                geocode[type] = res;
            }
        }
        return geocode;
    });

    ns.isCellular = function() {
        // This only works on chrome for android, but it's wonderfully useful.
        const type = navigator.connection && navigator.connection.type;
        return type === 'cellular';
    };

    ns.parseDistribution = async function(expression) {
        /* Return an array of components, where each component may be a Tag model
         * or textual operators. */
        const chunks = expression.split(/(@[^\s()-]+|<[0-9a-f-]{36}>)/i).filter(x => x);
        return await Promise.all(chunks.map(async x => {
            let tag;
            if (x.startsWith('@')) {
                tag = await F.atlas.getTag(x);
            } else if (ns.isUUID(x.slice(1, -1))) {
                tag = await F.atlas.getTag(x.slice(1, -1));
            }
            return {
                type: tag ? 'tag' : 'raw',
                value: tag ? tag : x
            };
        }));
    };

    ns.isUUID = function(value) {
        return !!(value && value.match && value.match(uuidRegex));
    };

    ns.requestFullscreen = async function(el) {
        F.assert(el instanceof Element);
        const request = el.requestFullscreen ||
                        el.mozRequestFullScreen ||
                        el.webkitRequestFullscreen;
        if (!request) {
            logger.error("requestFullscreen function not available");
        } else {
            return await request.call(el);
        }
    };

    ns.exitFullscreen = function() {
        const exit = document.exitFullscreen ||
                     document.mozCancelFullScreen ||
                     document.webkitExitFullscreen;
        if (!exit) {
            logger.error("exitFullscreen function not available");
        } else {
            return exit.call(document);
        }
    };

    ns.fullscreenElement = function() {
        return document.fullscreenElement ||
               document.mozFullScreenElement ||
               document.webkitFullscreenElement;
    };

    function shortenNumber(number, units) {
        for (let i=0; i < units.length; i++) {
            const unit = units[i];
            if (Math.abs(number) >= unit[0]) {
                if (unit[0] !== 0) {
                    number /= unit[0];
                }
                return [number, unit[1]];
            }
        }
    }

    ns.shortenNumber1000s = function(number) {
        const units = [
            [1000000000000, 'T'],
            [1000000000, 'G'],
            [1000000, 'M'],
            [1000, 'K'],
            [0, ''],
        ];
        return shortenNumber(number, units);
    };

    ns.shortenNumber1024s = function(number) {
        let units = [
            [1024 * 1024 * 1024 * 1024, 'T'],
            [1024 * 1024 * 1024, 'G'],
            [1024 * 1024, 'M'],
            [1024, 'K'],
            [0, ''],
        ];
        return shortenNumber(number, units);
    };

    ns.chooseTheme = function(theme) {
        const href = F.util.versionedURL(F.urls.static + `stylesheets/themes/${theme}.css`);
        const $link = $('head').find('.f-theme');
        if (!$link.length) {
            $('<link/>', {rel: 'stylesheet', href, class: 'f-theme'}).appendTo('head');
        } else {
            $link.attr('href', href);
        }
    };

    ns.fetchZendeskArticle = async function(id) {
        // TODO: Cache.
        const resp = await fetch(`${F.urls.zendeskArticles}/${id}.json`);
        if (!resp.ok) {
            throw new Error(resp);
        }
        return (await resp.json()).article;
    };

    async function domEventEnd(event, element, timeout) {
        const elements = element.length !== undefined ? element : [element];
        timeout = timeout === undefined ? 10000 : timeout;
        const progress = [];
        for (const el of elements) {
            progress.push(new Promise(resolve => {
                let timeoutId;
                if (timeout) {
                    timeoutId = setTimeout(() => resolve(), timeout);
                }
                const listener = ev => {
                    if (ev.target !== ev.currentTarget) {
                        // Ignore bubbled events
                        return;
                    }
                    el.removeEventListener(event, listener);
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    resolve(el);
                };
                el.addEventListener(event, listener);
            }));
        }
        await Promise.all(progress);
    }

    ns.transitionEnd = async function(element, timeout) {
        return await domEventEnd('transitionend', element, timeout);
    };

    ns.animationEnd = async function(element, timeout) {
        return await domEventEnd('animationend', element, timeout);
    };

    ns.forceReflow = function(element) {
        // https://stackoverflow.com/questions/24148403/trigger-css-transition-on-appended-element
        const elements = element.length !== undefined ? element : [element];
        for (const el of elements) {
            void(el.offsetWidth);  // Trick optimizers and force lookup.
        }
    };

    ns.initToggleButtons = function(element) {
        const elements = element.length !== undefined ? element : [element];
        for (const el of elements) {
            if (el.toggle) {
                continue;
            }
            const $el = $(el);
            el.toggle = activated => {
                $el.toggleClass($el.data('class'), !activated);
                $el.toggleClass($el.data('classActivated'), activated);
                $el.attr('title', $el.data(activated ? 'titleActivated' : 'title'));
                $el.toggleClass('activated', activated);
            };
            el.toggle($el.hasClass('activated'));
            el.addEventListener('click', ev => {
                el.toggle(!$el.hasClass('activated'));
            });
        }
    };

    ns.shareThreadLink = async function(thread, options) {
        options = options || {};
        const call = options.call;
        const lastShared = thread.get('lastSharedConversation');
        let convo;
        if (lastShared) {
            // Reuse last one if it less than 50% through it's lifetime.
            const expires = new Date(lastShared.expires);
            const created = new Date(lastShared.created);
            const now = new Date();
            if (expires > now) {
                const elapsed = now - created;
                const lifetime = expires - created;
                if (elapsed < lifetime * 0.50) {
                    logger.info("Reusing last shared conversation for:", thread.id);
                    convo = lastShared;
                }
            }
        }
        if (!convo) {
            logger.info("Creating new shared conversation for:", thread.id);
            convo = await F.atlas.fetch('/v1/conversation', {
                method: 'POST',
                json: {
                    thread_id: thread.id,
                    distribution: thread.get('distribution')
                }
            });
            thread.save({lastSharedConversation: convo});  // bg okay
        }
        const url = `${location.origin}/@chat/${convo.token}${ns.urlQuery({call})}`;
        if (options.skipPrompt) {
            return url;
        }
        const type = call ? 'call' : thread.get('type');
        if (navigator.share) {
            let typeThing;
            if (call) {
                typeThing = 'a call';
            } else if (type === 'announcement') {
                typeThing = 'an announcement';
            } else {
                typeThing = `a ${type}`;
            }
            const title = `${F.currentUser.getName()} shared ${typeThing}`;
            const text = `Use this URL to join the ${type}.`;
            await navigator.share({title, text, url});
        } else {
            const p = F.util.promptModal({
                size: 'tiny',
                icon: 'far fa-share-alt',
                header: `Share this ${type}`,
                content: `
                    <p>Use this URL to give others access to this ${type}...</p>
                    <p><samp class="url">${url}</samp></p>
                    <div class="field">
                        <div class="ui checkbox toggle">
                            <input type="checkbox" name="call"/>
                            <label>Automatically start call.</label>
                        </div>
                    </div>
                `.trim(),
            });
            p.view.on('show', async view => {
                const setUrl = async call => {
                    const $url = view.$('.url');
                    const fullUrl = call ? `${url}?call` : url;
                    $url.text(fullUrl);
                    ns.selectElements(view.$('.url'));
                    if (navigator.clipboard) {
                        await navigator.clipboard.writeText(fullUrl);
                        view.$('.footer').html("Copied to clipboard");
                        // clear confirmation if clipboard changes.
                        for (const ev of ['cut', 'copy']) {
                            addEventListener(ev, () => view.$('.footer').empty(), {once: true});
                        }
                    }
                };
                const $checkbox = view.$('.ui.checkbox');
                $checkbox.checkbox({
                    onChange: () => setUrl($checkbox.checkbox('is checked'))
                });
                await setUrl();
            });
        }
        return url;
    };

    ns.selectElements = function(items) {
        const elements = items.length !== undefined ? items : [items];
        const selection = getSelection();
        selection.removeAllRanges();
        for (const el of elements) {
            const range = document.createRange();
            range.selectNodeContents(el);
            selection.addRange(range);
        }
    };

    ns.validateBrowser = async function(options) {
        options = options || {};
        if (!self.crypto || !self.crypto.subtle) {
            let reason = '';
            if (location.protocol !== 'https:') {
                reason = `<br/><br/>Using a secure URL may help, e.g. <b><u>https</u></b>://${location.host}`;
            }
            F.util.confirmModal({
                header: 'Crypto API Unavailable',
                icon: 'red warning sign',
                content: 'This browser does not support the cryptographic APIs required.' + reason,
                confirm: false,
                dismiss: false,
                closable: false
            });
            throw new Error("Missing Crypto");
        }
        if (!options.skipStorage) {
            if (!self.indexedDB || !self.indexedDB.open) {
                F.util.confirmModal({
                    header: 'IndexedDB API Unavailable',
                    icon: 'red warning sign',
                    content: 'This browser does not support the database APIs required.',
                    confirm: false,
                    dismiss: false,
                    closable: false
                });
                throw new Error("Missing IndexedDB");
            }
            try {
                await new Promise((resolve, reject) => {
                    const dbName = 'dummy-test';
                    const dbRequest = indexedDB.open(dbName);
                    dbRequest.onerror = reject;
                    dbRequest.onsuccess = () => {
                        resolve();
                        dbRequest.result.close();
                        indexedDB.deleteDatabase(dbName);
                    };
                });
            } catch(e) {
                 F.util.confirmModal({
                    header: 'IndexedDB API Unavailable',
                    icon: 'red warning sign',
                    content: 'This browser does not support the database APIs required.',
                    confirm: false,
                    dismiss: false,
                    closable: false
                });
                throw new Error("Missing IndexedDB");
            }
            if (navigator.storage && navigator.storage.estimate) {
                const dbEst = await navigator.storage.estimate();
                if (dbEst.quota - dbEst.usage < 1 * 1024 * 1024) {
                    F.util.confirmModal({
                        header: 'Out of Space',
                        icon: 'red warning sign',
                        content: 'You are running too low on disk space to use the app. ' +
                                 'Free up some disk/ssd space and try again.',
                        confirm: false,
                        dismiss: false,
                        closable: false
                    });
                    throw new Error("Out of Space");
                }
            }
        }
    };

    ns.loadBlueImpImage = async function(blob, options) {
        if (!(blob instanceof Blob)) {
            throw new TypeError("Blob type requried");
        }
        return await new Promise((resolve, reject) => {
            const loading = loadImage(blob, (resp, data) => {
                if (resp.type === 'error') {
                    reject(resp.error || new Error("Generic Image Load Failure"));
                } else {
                    resolve([resp, data]);
                }
            }, options);
            if (!loading) {
                reject(new Error("Failed to load image"));
            }
        });
    };

    ns.getMnemonicWords = async function(value) {
        F.assert(typeof value === 'string');
        const points = new Uint8Array(Array.from(value).map(x => x.charCodeAt(0)));
        return (await mnemonic.Mnemonic.factory(points)).phrase.split(' ');
    };

    initIssueReporting();
    if (self.document) {
        initAudioContext();
    }
})();
