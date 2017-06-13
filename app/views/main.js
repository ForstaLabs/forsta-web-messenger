/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};

    var SocketView = Whisper.View.extend({
        className: 'status',
        initialize: function() {
            setInterval(this.updateStatus.bind(this), 5000);
        },
        updateStatus: function() {
            var className, message = '';
            if (typeof getSocketStatus === 'function') {
              switch(getSocketStatus()) {
                  case WebSocket.CONNECTING:
                      className = 'connecting';
                      break;
                  case WebSocket.OPEN:
                      className = 'open';
                      break;
                  case WebSocket.CLOSING:
                      className = 'closing';
                      break;
                  case WebSocket.CLOSED:
                      className = 'closed';
                      message = i18n('disconnected');
                      break;
              }
            if (!this.$el.hasClass(className)) {
                this.$el.attr('class', className);
                this.$el.text(message);
            }
          }
        }
    });

    F.ConversationStack = F.View.extend({
        className: 'conversation-stack',

        open: async function(conversation) {
            let $convo = this.$(`#conversation-${conversation.cid}`);
            if (!$convo.length) {
                const convoView = new F.ConversationView({model: conversation});
                await convoView.render();
                await convoView.fetchMessages();
                $convo = convoView.$el;
            }
            this.$el.prepend($convo);
            conversation.trigger('opened');
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

            this.navConversationView.listenTo(this.inbox,
                'add change:timestamp change:name change:number',
                this.navConversationView.sort);
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
            this.navAnnouncementView.listenTo(this.conversations,
                'add change:timestamp change:name change:number',
                this.navAnnouncementView.sort);

            /* XXX no contact search (yet)
            this.searchView = new Whisper.ConversationSearchView({
                el: this.$('.search-results'),
                input: this.$('input.search')
            });

            this.searchView.$el.hide();

            this.listenTo(this.searchView, 'hide', function() {
                this.searchView.$el.hide();
                this.navConversationView.$el.show();
            });
            this.listenTo(this.searchView, 'show', function() {
                this.searchView.$el.show();
                this.navConversationView.$el.hide();
            });
            this.listenTo(this.searchView, 'open',
                this.onSelectConversation.bind(this, null));
            */

            new SocketView().render().$el.appendTo(this.$('.socket-status'));

            await F.View.prototype.render.call(this);
            this.openMostRecentConversation();

            //$('nav .ui.sticky').sticky('nav');
            $('body > .ui.dimmer').removeClass('active');
        },

        events: {
            'click nav table thead': 'toggleNavSection',
            'click a.toggle-nav-vis': 'toggleNavBar',
            'select nav .conversation-item': 'onSelectConversation',
            'input input.search': 'filterContacts',
            'show .lightbox': 'showLightbox'
        },

        toggleNavBar: function(e) {
            const nav = $('nav');
            const app_toggle = $('article a.toggle-nav-vis');
            if (nav.width()) {
                app_toggle.fadeIn();
                nav.css('width', '0');
            } else {
                app_toggle.fadeOut();
                nav.css('width', '');
            }
        },

        toggleNavSection: function(e) {
            const el = $(e.currentTarget);
            const body = el.next('tbody');
            body.toggle();
        },

        filterContacts: function(e) {
            this.searchView.filterContacts(e);
            var input = this.$('input.search');
            if (input.val().length > 0) {
                input.addClass('active');
            } else {
                input.removeClass('active');
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
            //this.searchView.hideHints(); XXX not supported
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
            this.$el.append(e.target);
        }
    });
})();
