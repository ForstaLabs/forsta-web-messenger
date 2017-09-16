/*
 * vim: ts=4:sw=4:expandtab
 */
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
            const notifmsg = $('#f-notifications-message');
            notifmsg.on('click', '.button', async function() {
                const perm = await Notification.requestPermission();
                if (perm !== 'default') {
                    notifmsg.addClass('hidden');
                    if (perm === 'granted') {
                        await initBackgroundNotifications();
                    }
                }
            });
            notifmsg.removeClass('hidden');
        } else {
            console.warn("Notifications have been blocked");
        }
    }

    F.ThreadStack = F.View.extend({
        className: 'thread-stack',

        open: async function(thread) {
            if (thread && thread === this._opened) {
                this.$el.first().transition('pulse');
                return;
            }
            let $thread = this.$(`#thread-${thread.cid}`);
            let newThreadView;
            if (!$thread.length) {
                const View = {
                    conversation: F.ConversationView,
                    announcement: F.AnnouncementView
                }[thread.get('type')];
                newThreadView = new View({model: thread});
                $thread = newThreadView.$el;
                await newThreadView.render();
            }
            this.$el.prepend($thread);
            if (newThreadView) {
                await newThreadView.fetchMessages();
            }
            if (this._opened) {
                this._opened.trigger('closed');
            }
            this._opened = thread;
            thread.trigger('opened', thread);
        }
    });

    F.MainView = F.View.extend({
        el: 'body',

        initialize: function() {
            this.users = F.foundation.getUsers();
            this.tags = F.foundation.getTags();
            this.threads = F.foundation.getThreads();
            this.threads.on('add remove change:unreadCount',
                            _.debounce(this.updateUnreadCount.bind(this), 400));
        },

        render: async function() {
            initNotifications();
            let headerRender;
            this.headerView = new F.HeaderView({
                el: '#f-header-view',
                model: F.currentUser
            });
            headerRender = this.headerView.render();
            this.threadStack = new F.ThreadStack({el: '#f-thread-stack'});
            this.navView = new F.NavView({
                el: '#f-nav-view',
                collection: this.threads
            });
            (new F.NewThreadView({el: 'nav'})).render();
            if (!(await F.state.get('navCollapsed'))) {
                await this.toggleNavBar();
            }
            await Promise.all([
                headerRender,
                this.threadStack.render(),
                this.navView.render()
            ]);
            await F.View.prototype.render.call(this);
            this.$('> .ui.dimmer').removeClass('active');
            setTimeout(this.navView.refreshItemsLoop.bind(this.navView), 30);
        },

        events: {
            'click .f-toggle-nav': 'onToggleNav',
            'select nav': 'onSelectThread'
        },

        onToggleNav: async function() {
            await this.toggleNavBar();
        },

        toggleNavBar: async function(forceCollapse) {
            const $nav = this.$('nav');
            const collapsed = !$nav.hasClass('expanded');
            if (forceCollapse && collapsed) {
                return;
            }
            $nav.toggleClass('expanded', collapsed);
            await F.state.put('navCollapsed', !collapsed);
        },

        updateUnreadCount: async function() {
            const unread = this.threads.map(m =>
                m.get('unreadCount')).reduce((a, b) =>
                    a + b, 0);
            F.router && F.router.setTitleUnread(unread);
            await F.state.put("unreadCount", unread);
        },

        onSelectThread: async function(e, thread) {
            await this.openThread(thread);
        },

        openThreadById: async function(id) {
            return await this.openThread(this.threads.get(id));
        },

        openThread: async function(thread) {
            if (F.util.isSmallScreen()) {
                this.toggleNavBar(/*forceCollapse*/ true);
            }
            let title;
            let id;
            if (!thread) {
                const defaultView = await this.openDefaultThread();
                this.threadStack.$el.prepend(defaultView.el);
                title = 'Welcome';
                id = 'welcome';
            } else {
              await this.threadStack.open(thread);
              await F.state.put('mostRecentThread', thread.id);
              title = thread.getNormalizedTitle();
              id = thread.id;
            }
            F.router.setTitleHeading($(`<span>${title}</span>`).text());
            F.router.addHistory(`/@/${id}`);
        },

        openDefaultThread: async function() {
            const view = new F.DefaultThreadView();
            await view.render();
            return view;
        },

        openMostRecentThread: async function() {
            const cid = await F.state.get('mostRecentThread');
            if (!cid) {
                console.warn("No recent thread found");
            }
            await this.openThreadById(cid);
        }
    });
})();
