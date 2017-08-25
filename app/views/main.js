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
            const loadingDimmer = $('#f-thread-loading-dimmer');
            loadingDimmer.addClass('active');
            let $thread = this.$(`#thread-${thread.cid}`);
            if (!$thread.length) {
                const View = {
                    conversation: F.ConversationView,
                    announcement: F.AnnouncementView
                }[thread.get('type')];
                const threadView = new View({model: thread});
                await threadView.fetchMessages();
                await threadView.render();
                $thread = threadView.$el;
            }
            this.$el.prepend($thread);
            if (this._opened) {
                this._opened.trigger('closed');
            }
            this._opened = thread;
            thread.trigger('opened');
            loadingDimmer.removeClass('active');
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
            if (!F.modalMode) {
                this.headerView = new F.HeaderView({
                    el: '#f-header-menu-view',
                    model: F.currentUser
                });
                headerRender = this.headerView.render();
            } else {
                $('#f-header-menu-view').hide();
                $('body').css('zoom', '0.9');
            }
            this.threadStack = new F.ThreadStack({
                el: '#f-article-thread-stack'
            });
            this.navView = new F.NavView({
                el: '#f-nav-view',
                collection: this.threads
            });
            (new F.NewThreadView({
                el: 'nav',
                collection: this.tags
            })).render();
            if (!(await F.state.get('navCollapsed')) && !F.modalMode) {
                await this.toggleNavBar();
            }
            await Promise.all([
                headerRender,
                this.threadStack.render(),
                this.navView.render()
            ]);
            await F.View.prototype.render.call(this);
            this.$('> .ui.dimmer').removeClass('active');
        },

        events: {
            'click .f-toggle-nav': 'toggleNavBar',
            'select nav': 'onSelectThread'
        },

        toggleNavBar: async function() {
            const nav = this.$('nav');
            const icon = this.$('.f-toggle-nav i');
            const collapsed = !nav.width();
            if (collapsed) {
                icon.removeClass('right').addClass('left');
                nav.css('flex', '');
            } else {
                icon.removeClass('left').addClass('right');
                nav.css('flex', '0 0 0');
            }
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
            let name;
            let urn;
            if (!thread) {
                const defaultView = await this.openDefaultThread();
                this.threadStack.$el.prepend(defaultView.el);
                name = 'Welcome';
                urn = 'welcome';
            } else {
              await this.threadStack.open(thread);
              await F.state.put('mostRecentThread', thread.id);
              urn = thread.id;
              name = thread.get('name');
          }
          F.router.setTitleHeading(name);
          F.router.addHistory(`/@/${urn}`);
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
