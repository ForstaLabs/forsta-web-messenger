/*
 * vim: ts=4:sw=4:expandtab
 */
(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.router = {};

    let _router;
    const app_name = 'Forsta';
    const favicon = $('#favicon');
    const image_path = F.urls.static + 'images/';
    let title_heading;
    let title_unread = 0;

    function renderTitle(no_unread_count) {
        let title;
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
        return image_path + icon;
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
        routes: {
            "@/:ident": 'onConversation',
        },

        onConversation: function(ident) {
            console.info("Routing to:", ident);
            F.mainView.openConversationById(ident);
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
        return Backbone.history.start({pushState: true});
    }
}());
