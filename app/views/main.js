/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    async function initBackgroundNotifications() {
        const s = new F.BackgroundNotificationService()
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
            conversation.trigger('opened');
            loadingDimmer.removeClass('active');
        }
    });

    F.MainView = F.View.extend({
        el: 'body',

        initialize: function() {
            this.conversations = F.foundation.getConversations();
            this.inbox = new F.InboxCollection();
            this.users = new F.UserCollection();
            this.tags = new F.TagCollection();
            this.inbox.on('add remove change:unreadCount',
                          _.debounce(this.updateUnreadCount.bind(this), 200));
            this.conversations.on('add change:active_at', this.inbox.addActive.bind(this.inbox));
        },

        render: async function() {
            console.log('%cRendering Main View', 'font-size: 110%; font-weight: bold;');

            initNotifications();

            await Promise.all([
                this.conversations.fetchActive(),
                //this.users.fetch(),  // XXX Too slow to wait for...
                //this.tags.fetch()  // XXX Too slow to wait for...
            ]);
            this.users.fetch(); // XXX // slow right now
            this.tags.fetch(); // XXX slow right now

            this.headerView = new F.HeaderView({
                el: '#f-header-menu-view',
                model: new Backbone.Model(F.user_profile)
            });
            this.conversationStack = new F.ConversationStack({
                el: '#f-article-conversation-stack'
            });
            this.newConvoView = new F.NewConvoView({
                el: '#f-new-conversation',
                collection: this.tags
            });
            this.navConversationsView = new F.NavConversationsView({
                el: '#f-nav-conversations-view',
                collection: this.inbox
            });
            this.navUsersView = new F.NavUsersView({
                el: '#f-nav-users-view',
                collection: this.users
            });
            this.navTagsView = new F.NavTagsView({
                el: '#f-nav-tags-view',
                collection: this.tags
            });

            await Promise.all([
                this.headerView.render(),
                this.conversationStack.render(),
                this.newConvoView.render(),
                this.navConversationsView.render(),
                this.navUsersView.render(),
                this.navTagsView.render()
            ]);
            await F.View.prototype.render.call(this);

            this.$('.ui.dropdown').dropdown({
                allowAdditions: true
            });
            this.$('> .ui.dimmer').removeClass('active');
        },

        events: {
            'click .toggle-nav-vis': 'toggleNavBar',
            'select nav .conversation-item': 'onSelectConversation',
            'show .lightbox': 'showLightbox'
        },

        toggleNavBar: function(e) {
            const nav = this.$('nav');
            const app_toggle = $('article a.toggle-nav-vis');
            if (nav.width()) {
                app_toggle.fadeIn();
                nav.css('flex', '0 0 0');
            } else {
                app_toggle.fadeOut();
                nav.css('flex', '');
            }
        },

        updateUnreadCount: async function() {
            const unread = this.inbox.map(m => m.get('unreadCount')).reduce((a, b) => a + b);
            F.router && F.router.setTitleUnread(unread);
            await F.state.put("unreadCount", unread);
        },

        onSelectConversation: async function(e, convo) {
            await this.openConversation(convo);
        },

        openConversationById: async function(id) {
            const c = this.conversations.get(id);
            console.assert(c, 'No conversation found for:', id);
            return await this.openConversation(c);
        },

        openConversation: async function(conversation) {
            await this.conversationStack.open(conversation);
            await F.state.put('mostRecentConversation', conversation.id);
            F.router.setTitleHeading(conversation.getTitle());
            F.router.addHistory(`/@/${conversation.id}`);
        },

        openMostRecentConversation: async function() {
            const cid = await F.state.get('mostRecentConversation');
            if (!cid) {
                console.warn("No recent conversation found");
                return;
            }
            await this.openConversationById(cid);
        },

        showLightbox: function(e) {
            console.warn("XXX: Please refactor this into a semantic-ui modal");
            this.$el.append(e.target);
        }
    });
})();
