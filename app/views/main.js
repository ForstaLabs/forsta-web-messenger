/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};

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
            console.log('%cRendering Main View',
                        'font-size: 110%; font-weight: bold;');
            if (window.Notification && Notification.permission === "default") {
                const notifmsg = $('#f-notifications-message');
                notifmsg.on('click', '.button', async function() {
                    const perm = await Notification.requestPermission();
                    if (perm !== 'default') {
                        notifmsg.addClass('hidden');
                    }
                });
                notifmsg.removeClass('hidden');
            }

            this.inbox = Whisper.getInboxCollection();
            this.conversations = Whisper.getConversations();

            this.headerView = new F.HeaderView({
                el: '#f-header-menu-view',
                model: new Backbone.Model(F.user_profile)
            }).render();

            this.conversationStack = new F.ConversationStack({
                el: '#f-article-conversation-stack'
            });
            await this.conversationStack.render();

            this.navConversationView = new F.NavConversationView({
                el: '#f-nav-conversation-view',
                collection: this.inbox
            });
            await this.navConversationView.render();

            /*this.navPinnedView = new F.NavConversationView({
                el: '#f-nav-pinned-view',
                templateUrl: 'templates/nav/pinned.html',
                collection: this.conversations
            }).render();  XXX async render now*/

            this.navAnnouncementView = new F.NavConversationView({
                el: '#f-nav-announcements-view',
                templateUrl: 'templates/nav/announcements.html',
                collection: this.conversations
            });
            await this.navAnnouncementView.render();

            await F.View.prototype.render.call(this);
            this.openMostRecentConversation();

            //$('nav .ui.sticky').sticky('nav');
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
                nav.css('width', '0');
            } else {
                app_toggle.fadeOut();
                nav.css('width', '');
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
