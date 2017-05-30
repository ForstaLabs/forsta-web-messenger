/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};
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
        open: function(conversation) {
            var id = 'conversation-' + conversation.cid;
            if (id !== this.el.firstChild.id) {
                this.$el.first().find('video, audio').each(function() {
                    this.pause();
                });
                var $el = this.$('#'+id);
                if ($el === null || $el.length === 0) {
                    var view = new Whisper.ConversationView({
                        model: conversation,
                        window: this.model.window
                    });
                    $el = view.$el;
                }
                $el.prependTo(this.el);
                conversation.trigger('opened');
            }
        }
    });

    F.MainView = F.View.extend({
        el: 'body',

        initialize: function(options) {
            //this.render();
            //this.$el.attr('tabindex', '1');
            const inboxCollection = getInboxCollection();

            this.orgView = new F.View({
                templateName: 'f-article-org',
                el: '#f-article-org-view'
            }).render();

            F.ccsm.getUserProfile().then(user => {
                this.headerView = new F.HeaderView({
                    el: '#f-header-menu-view',
                    model: new Backbone.Model(user)
                }).render();
            });

            this.conversationStack = new F.ConversationStack({
                el: '#f-article-feed-view'
            }).render();

            this.navConversationView = new F.NavConversationView({
                el: '#f-nav-conversation-view',
                collection: inboxCollection
            }).render();

            this.navPinnedView = new F.NavConversationView({
                el: '#f-nav-pinned-view',
                templateName: 'f-nav-pinned',
                collection: inboxCollection
            }).render();

            this.navAnnouncementView = new F.NavConversationView({
                el: '#f-nav-announcements-view',
                templateName: 'f-nav-announcements',
                collection: inboxCollection
            }).render();

            this.navConversationView.listenTo(inboxCollection,
                    'add change:timestamp change:name change:number',
                    this.navConversationView.sort);

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
                this.openConversation.bind(this, null));

            new SocketView().render().$el.appendTo(this.$('.socket-status'));
        },

        events: {
            'click': 'onClick',
            'click #header': 'focusHeader',
            'click .conversation': 'focusConversation',
            'click .global-menu .hamburger': 'toggleMenu',
            'click .show-debug-log': 'showDebugLog',
            'click .showSettings': 'showSettings',
            'click nav table thead': 'toggleNavSection',
            'click a.toggle-nav-vis': 'toggleNavBar',
            'select .gutter .conversation-list-item': 'openConversation',
            'input input.search': 'filterContacts',
            'show .lightbox': 'showLightbox'
        },

        toggleNavBar: function(e) {
            const nav = $('nav');
            const app_toggle = $('article a.toggle-nav-vis');
            if (nav.width()) {
                app_toggle.fadeIn();
                nav.width(0);
            } else {
                app_toggle.fadeOut();
                nav.width(350); // XXX
            }
        },

        toggleNavSection: function(e) {
            const el = $(e.currentTarget);
            const body = el.next('tbody');
            body.toggle();
        },

        focusConversation: function(e) {
            if (e && this.$(e.target).closest('.placeholder').length) {
                return;
            }
            this.$('#header, .gutter').addClass('inactive');
            this.$('.conversation-stack').removeClass('inactive');
        },

        focusHeader: function() {
            this.$('.conversation-stack').addClass('inactive');
            this.$('#header, .gutter').removeClass('inactive');
            this.$('.conversation:first .menu').trigger('close');
        },

        showSettings: function() {
            var view = new Whisper.SettingsView();
            view.$el.appendTo(this.el);
            view.$el.on('change-theme', this.applyTheme.bind(this));
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

        openConversation: function(e, conversation) {
            debugger;
            this.searchView.hideHints();
            conversation = ConversationController.create(conversation);
            this.conversationStack.open(conversation);
            this.focusConversation();
        },

        toggleMenu: function() {
            this.$('.global-menu .menu-list').toggle();
        },

        showDebugLog: function() {
            this.$('.debug-log').remove();
            new Whisper.DebugLogView().$el.appendTo(this.el);
        },

        showLightbox: function(e) {
            this.$el.append(e.target);
        },

        closeRecording: function(e) {
            if (e && this.$(e.target).closest('.capture-audio').length > 0 ) {
                return;
            }
            this.$('.conversation:first .recorder').trigger('close');
        },

        closeMenu: function(e) {
            if (e && this.$(e.target).parent('.global-menu').length > 0 ) {
                return;
            }

            this.$('.global-menu .menu-list').hide();
        },

        onClick: function(e) {
            this.closeMenu(e);
            this.closeRecording(e);
        }
    });

})();
