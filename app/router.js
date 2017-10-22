// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.router = {};

    let _router;
    const app_name = 'Forsta';
    const favicon = $('#favicon');
    const imagePath = F.urls.static + 'images/';
    let title_heading;
    let title_unread = 0;

    function renderTitle(no_unread_count) {
        const parts = [];
        if (!no_unread_count && title_unread > 0) {
            parts.push(`${title_unread} unread |`);
        }
        if (title_heading && title_heading.length) {
            parts.push(title_heading);
        }
        if (parts.length) {
            parts.push('-');
        }
        parts.push(app_name);
        return parts.join(' ');
    }

    function renderFaviconHref() {
        const icon = (title_unread > 0) ? 'favicon-pending.png' : 'favicon.png';
        return F.util.versionedURL(imagePath + icon);
    }

    ns.setTitleHeading = function(value) {
        title_heading = value;
        document.title = renderTitle();
    };

    ns.setTitleUnread = function(count) {
        title_unread = count;
        document.title = renderTitle();
        favicon.attr('href', renderFaviconHref);
    };

    ns.addHistory = function(url) {
        const title = renderTitle(/*no_unread_count*/ true);
        _router.navigate(url, {title});
    };

    ns.Router = Backbone.Router.extend({

        uuidRegex: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,

        routes: {
            "@/:ident": 'onNav'
        },

        onNav: async function(ident) {
            if (ident.match(this.uuidRegex)) {
                console.info("Routing to:", ident);
                await F.mainView.openThreadById(ident, /*skipHistory*/ true);
            } else if (ident === '@welcome') {
                await F.mainView.openDefaultThread();
            } else {
                const tags = F.ccsm.sanitizeTags(ident);
                console.info("Finding/starting conversation with:", tags);
                const threads = F.foundation.getThreads();
                let thread;
                try {
                    thread = await threads.ensure(tags, {type: 'conversation'});
                } catch(e) {
                    if (e instanceof ReferenceError) {
                        console.warn("Invalid conversation expression:", tags);
                        await F.mainView.openDefaultThread();
                        return;
                    } else {
                        throw e;
                    }
                }
                await F.mainView.openThread(thread, /*skipHistory*/ true);
            }
        }
    });

    /* Allow custom title to be used. */
    const history_navigate_super = Backbone.History.prototype.navigate;
    Backbone.History.prototype.navigate = function(fragment, options) {
        if (!this._usePushState) {
            return history_navigate_super.apply(this, arguments);
        }
        if (!Backbone.History.started) {
            return false;
        }
        fragment = this.getFragment(fragment || '');
        let rootPath = this.root;
        if (fragment === '' || fragment.charAt(0) === '?') {
            rootPath = rootPath.slice(0, -1) || '/';
        }
        const url = rootPath + fragment;
        const pathStripper = /#.*$/;
        fragment = this.decodeFragment(fragment.replace(pathStripper, ''));
        if (this.fragment === fragment) {
            return;
        }
        this.fragment = fragment;
        const state = options.state || {};
        const title = options.title || document.title;
        const title_save = document.title;
        document.title = title;  // Unfortunately browsers ignore the title arg currently.
        try {
            this.history[options.replace ? 'replaceState' : 'pushState'](state, title, url);
        } finally {
            document.title = title_save;
        }
        if (options.trigger) {
            return this.loadUrl(fragment);
        }
    };

    ns.start = function() {
        _router = new ns.Router();
        $(document).on("click", "a[data-route]", ev => {
            const route = ev.target.dataset.route;
            _router.navigate(route, {trigger: true});
        });
        return Backbone.history.start({pushState: true});
    };
}());
