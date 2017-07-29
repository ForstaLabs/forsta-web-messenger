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

    F.ConversationStack = F.View.extend({
        className: 'conversation-stack',

        open: async function(conversation) {
            const loadingDimmer = $('#f-conversation-loading-dimmer');
            loadingDimmer.addClass('active');
            let $convo = this.$(`#conversation-${conversation.cid}`);
            if (!$convo.length) {
                const convoView = new F.ConversationView({model: conversation});
                await convoView.render();
                await convoView.fetchMessages();
                $convo = convoView.$el;
            }
            this.$el.prepend($convo);
            if (this._opened) {
                this._opened.trigger('closed');
            }
            this._opened = conversation;
            conversation.trigger('opened');
            loadingDimmer.removeClass('active');
        }
    });

    F.MainView = F.View.extend({
        el: 'body',

        initialize: function() {
            this.conversations = F.foundation.getConversations();
            this.users = F.foundation.getUsers();
            this.tags = F.foundation.getTags();
            this.conversations.on('add remove change:unreadCount',
                  _.debounce(this.updateUnreadCount.bind(this), 400));
        },

        render: async function() {
            console.log('%cRendering Main View', 'font-size: 110%; font-weight: bold;');
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
            this.conversationStack = new F.ConversationStack({
                el: '#f-article-conversation-stack'
            });
            this.newConvoView = new F.NewConvoView({
                el: '#f-new-conversation',
                collection: this.tags
            });
            this.navConversationsView = new F.NavConversationsView({
                el: '#f-nav-conversations-view',
                collection: this.conversations
            });

            if (!(await F.state.get('navCollapsed')) && !F.modalMode) {
                await this.toggleNavBar();
            }

            await Promise.all([
                headerRender,
                this.conversationStack.render(),
                this.newConvoView.render(),
                this.navConversationsView.render(),
            ]);
            await F.View.prototype.render.call(this);
            this.$('> .ui.dimmer').removeClass('active');
        },

        events: {
            'click .f-toggle-nav': 'toggleNavBar',
            'select nav .conversation-item': 'onSelectConversation'
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
            const unread = this.conversations.map(m =>
                m.get('unreadCount')).reduce((a, b) =>
                    a + b, 0);
            F.router && F.router.setTitleUnread(unread);
            await F.state.put("unreadCount", unread);
        },

        onSelectConversation: async function(e, convo) {
            await this.openConversation(convo);
        },

        openConversationById: async function(id) {
            const c = this.conversations.get(id);
            if (!c) {
                console.warn('No conversation found for:', id);
                return;
            }
            return await this.openConversation(c);
        },

        openConversation: async function(conversation) {
            await this.conversationStack.open(conversation);
            await F.state.put('mostRecentConversation', conversation.id);
            F.router.setTitleHeading(conversation.get('name'));
            F.router.addHistory(`/@/${conversation.id}`);
        },

        openMostRecentConversation: async function() {
            const cid = await F.state.get('mostRecentConversation');
            if (!cid) {
                console.warn("No recent conversation found");
                return;
            }
            await this.openConversationById(cid);
        }
    });
})();
