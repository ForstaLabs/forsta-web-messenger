// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    async function initBackgroundNotifications() {
        const s = new F.BackgroundNotificationService();
        await s.start();
    }

    async function initNotifications() {
        if (!self.Notification) {
            console.warn("Browser does not support notifications");
            return;
        }
        if (Notification.permission === "granted") {
            await initBackgroundNotifications();
        } else if (Notification.permission === "default") {
            const maxHideWindow = Math.floor(Date.now() / 7 / 86400 / 1000).toString();
            const notifNag = $('#f-notifications-nag').nag({
                storageMethod: 'localstorage',
                key: 'notificationsNag-' + maxHideWindow
            }).on('click', '.button', async () => {
                notifNag.find('.close').click();  // Only way to store dismiss state.
                const perm = await Notification.requestPermission();
                if (perm !== 'default') {
                    if (perm === 'granted') {
                        await initBackgroundNotifications();
                    }
                }
            });
        } else {
            console.warn("Notifications have been blocked");
        }
    }

    async function updatesMonitor() {
        let delay = 1800;
        while (true) {
            await relay.util.sleep(delay);
            delay *= 2;
            await F.util.online();
            let availableVersion;
            try {
                availableVersion = (await (await fetch('/@version.json')).json()).version;
            } catch(e) {
                console.warn("Failed to fetch /@version.json", e);
                continue;
            }
            if (availableVersion !== F.version) {
                $('#f-version-update-nag').nag().on('click', '.button', async () => {
                    location.reload(/*noCache*/ true);
                    await relay.util.never();
                });
                return;
            }
        }
    }

    F.ThreadStack = F.View.extend({
        className: 'thread-stack',

        initialize: function() {
            this._views = new Map();
        },

        get: function(thread) {
            return this._views.get(thread);
        },

        open: async function(thread) {
            if (thread && thread === this._opened) {
                this.$el.first().transition('pulse');
                thread.trigger('opened', thread);
                return;
            }
            const $existing = this.$(`#thread-${thread.cid}`);
            if ($existing.length) {
                this.$el.prepend($existing);
            } else {
                const View = {
                    conversation: F.ConversationView,
                    announcement: F.AnnouncementView
                }[thread.get('type')];
                const view = new View({model: thread});
                this.$el.prepend(view.$el);
                await view.render();
                this._views.set(thread, view);
            }
            this.setOpened(thread);
            F.router.setTitleHeading(thread.getNormalizedTitle(/*text*/ true));
            thread.trigger('opened', thread);
        },

        isOpen: function(thread) {
            return this._opened === thread;
        },

        setOpened: function(thread) {
            const changeEvents = [
                'change:title',
                'change:titleFallback',
                'change:distributionPretty'
            ].join(' ');
            if (this._opened) {
                this.stopListening(this._opened, changeEvents, this.onTitleChange);
                this._opened.trigger('closed');
            }
            this._opened = thread;
            if (thread) {
                this.listenTo(thread, changeEvents, this.onTitleChange);
            }
        },

        onTitleChange: function() {
            F.router.setTitleHeading(this._opened.getNormalizedTitle(/*text*/ true));
        }
    });

    F.MainView = F.View.extend({
        el: 'body',

        events: {
            'click .f-toggle-nav': 'onToggleNav',
            'select nav': 'onSelectThread',
            'dragstart .f-nav-view': 'onNavDragStart',
            'dragend .f-nav-view': 'onNavDragEnd'
        },

        initialize: function() {
            F.foundation.allThreads.on('add remove change:unreadCount',
                                       _.debounce(this.updateUnreadCount.bind(this), 400));
            updatesMonitor();
        },

        render: async function() {
            initNotifications();
            this.headerView = new F.HeaderView({
                el: '#f-header-view',
                model: F.currentUser
            });
            this.threadStack = new F.ThreadStack({el: '#f-thread-stack'});
            const $navPanel = $('#f-nav-panel');

            this.navPinnedView = new F.NavPinnedView({collection: F.foundation.pinnedThreads});
            $navPanel.append(this.navPinnedView.$el);

            this.navRecentView = new F.NavRecentView({collection: F.foundation.recentThreads});
            $navPanel.append(this.navRecentView.$el);

            (new F.NewThreadView({el: 'nav'})).render();
            if (!F.util.isSmallScreen() && await F.state.get('navCollapsed')) {
                await this.toggleNavBar();
            }
            await Promise.all([
                this.headerView.render(),
                this.threadStack.render(),
                this.navPinnedView.render(),
                this.navRecentView.render(),
            ]);
            await F.View.prototype.render.call(this);
            this.navPinnedView.refreshItemsLoop();
            this.navRecentView.refreshItemsLoop();
        },

        onNavDragStart: function(ev) {
            this.navPinnedView.trigger('anydragstart', ev);
            this.navRecentView.trigger('anydragstart', ev);
        },

        onNavDragEnd: function(ev) {
            this.navPinnedView.trigger('anydragend', ev);
            this.navRecentView.trigger('anydragend', ev);
        },

        onToggleNav: async function() {
            await this.toggleNavBar();
        },

        toggleNavBar: async function(collapse, skipState) {
            const $nav = this.$('nav');
            const collapsed = !$nav.hasClass('expanded');
            if (collapse === undefined) {
                collapse = !collapsed;
            }
            if (collapse === collapsed) {
                return;
            }
            $nav.toggleClass('expanded', !collapse);
            await F.state.put('navCollapsed', collapse);
            this.headerView.updateNavCollapseState(collapse);
            if (!skipState && F.util.isSmallScreen()) {
                F.router.addState({navCollapsed: collapse});
            }
        },

        updateUnreadCount: async function() {
            const unread = F.foundation.allThreads.map(m =>
                m.get('unreadCount')).reduce((a, b) =>
                    a + b, 0);
            F.router && F.router.setTitleUnread(unread);
            await F.state.put("unreadCount", unread);
            this.headerView.updateUnreadCount(unread);
        },

        onSelectThread: async function(e, thread) {
            await this.openThread(thread);
        },

        openThreadById: async function(id, skipHistory) {
            return await this.openThread(F.foundation.allThreads.get(id), skipHistory);
        },

        _defaultThreadView: null,

        openThread: async function(thread, skipHistory) {
            if (F.util.isSmallScreen()) {
                this.toggleNavBar(/*collapse*/ true);
            }
            let id;
            if (!thread) {
                if (!this._defaultThreadView) {
                    this._defaultThreadView = new F.DefaultThreadView();
                    await this._defaultThreadView.render();
                }
                this.threadStack.$el.prepend(this._defaultThreadView.el);
                this.threadStack.setOpened(null);
                F.router.setTitleHeading('Welcome');
                id = 'welcome';
            } else {
                await this.threadStack.open(thread);
                await F.state.put('mostRecentThread', thread.id);
                id = thread.id;
            }
            if (!skipHistory) {
                F.router.addHistory(`/@/${id}`);
            }
            return thread;
        },

        openDefaultThread: async function() {
            return await this.openThread(null);
        },

        openMostRecentThread: async function() {
            const cid = await F.state.get('mostRecentThread');
            if (!cid) {
                console.warn("No recent thread found");
            }
            return await this.openThreadById(cid);
        },

        isThreadOpen: function(thread) {
            return this.threadStack.isOpen(thread);
        }
    });
})();
