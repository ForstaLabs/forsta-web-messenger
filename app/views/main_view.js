/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.Forsta = window.Forsta || {};

    Forsta.ConversationListView = Forsta.ListView.extend({
        tagName: 'div',
        itemView: Whisper.ConversationListItemView,
        sort: function(conversation) {
            var $el = this.$('.' + conversation.cid);
            if ($el && $el.length > 0) {
                var index = getInboxCollection().indexOf(conversation);
                if (index === this.$el.index($el)) {
                    return;
                }
                if (index === 0) {
                    this.$el.prepend($el);
                } else if (index === this.collection.length - 1) {
                    this.$el.append($el);
                } else {
                    $el.insertBefore(this.$('.conversation-list-item')[index+1]);
                }
            }
        }
    });


    Forsta.MainView = Backbone.View.extend({

        //className: 'inbox',

        applyTheme: function() {
            var theme = storage.get('theme-setting') || 'forsta-light';
            console.warn("Theming not supported yet");
            return;
            this.$el.removeClass('forsta-light')
                    .removeClass('forsta-dark')
                    .addClass(theme);
        },

        initialize: async function(options) {
            this.render();
            this.applyTheme();
            //this.$el.attr('tabindex', '1');  Select first convo !
            var inboxCollection = getInboxCollection();
            this.inboxListView = new Forsta.ConversationListView({
                el         : this.$('.inbox'),
                collection : inboxCollection
            }).render();

            this.inboxListView.listenTo(inboxCollection,
                    'add change:timestamp change:name change:number',
                    this.inboxListView.sort);

            this.searchView = new Whisper.ConversationSearchView({
                el    : this.$('.search-results'),
                input : this.$('input.search')
            });

            this.searchView.$el.hide();

            this.listenTo(this.searchView, 'hide', function() {
                this.searchView.$el.hide();
                this.inboxListView.$el.show();
            });
            this.listenTo(this.searchView, 'show', function() {
                this.searchView.$el.show();
                this.inboxListView.$el.hide();
            });
            this.listenTo(this.searchView, 'open',
                this.openConversation.bind(this, null));
        },

        events: {
            'click': 'onClick',
            'click #header': 'focusHeader',
            'click .conversation': 'focusConversation',
            'click .global-menu .hamburger': 'toggleMenu',
            'click .show-debug-log': 'showDebugLog',
            'click .showSettings': 'showSettings',
            'select .gutter .conversation-list-item': 'openConversation',
            'input input.search': 'filterContacts',
            'show .lightbox': 'showLightbox'
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
            this.searchView.hideHints();
            conversation = ConversationController.create(conversation);
            this.conversation_stack.open(conversation);
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
