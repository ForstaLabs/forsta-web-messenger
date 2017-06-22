/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};

    async function initBackgroundNotifications() {
        const s = new F.BackgroundNotificationService()
        await s.start();
    }

    async function initNotifications() {
        if (!window.Notification) {
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

        render: async function() {
            console.log('%cRendering Main View', 'font-size: 110%; font-weight: bold;');

            initNotifications();

            this.inbox = F.getInboxCollection();
            this.conversations = F.getConversations();

            this.headerView = new F.HeaderView({
                el: '#f-header-menu-view',
                model: new Backbone.Model(F.user_profile)
            }).render();

            this.conversationStack = new F.ConversationStack({
                el: '#f-article-conversation-stack'
            });
            await this.conversationStack.render();

            /* Nav blocks... work on this .. XXX */
            this.navConversationsView = new F.NavConversationsView({
                el: '#f-nav-conversations-view',
                collection: this.inbox
            });
            await this.navConversationsView.render();
            this.navUsersView = new F.NavUsersView({
                el: '#f-nav-users-view',
                collection: this.inbox
            });
            await this.navUsersView.render();
            this.navTagsView = new F.NavTagsView({
                el: '#f-nav-tags-view',
                template: 'nav/tags.html',
                collection: this.conversations
            });
            await this.navTagsView.render();

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
            storage.put('most-recent-conversation', conversation.id);
            F.router.setTitleHeading(conversation.getTitle());
            F.router.addHistory(`/@/${conversation.id}`);
        },

        openMostRecentConversation: async function() {
            const cid = storage.get('most-recent-conversation');
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
