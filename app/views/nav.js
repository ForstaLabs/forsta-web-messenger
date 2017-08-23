/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.NavItemView = F.View.extend({
        tagName: 'tr',

        className: 'nav-item',

        events: {
            'click': 'select'
        },

        initialize: function() {
            const changeAttrs = [
                'title',
                'lastMessage',
                'unreadCount',
                'timestamp',
                'distribution'
            ].map(x => 'change:' + x);
            this.listenTo(this.model, changeAttrs.join(' '),
                          _.debounce(this.render.bind(this), 200));
            this.listenTo(this.model, 'remove', this.remove);
            this.listenTo(this.model, 'opened', this.markSelected);
        },

        markSelected: function() {
            this.$el.addClass('active').siblings('.active').removeClass('active');
        },

        select: function() {
            this.markSelected();
            this.$el.trigger('select', this.model);
        },

        render_attributes: async function() {
            return Object.assign({
                avatarProps: (await this.model.getAvatar()),
                title: this.model.get('title') || this.model.get('distributionPretty')
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            var unread = this.model.get('unreadCount');
            if (unread > 0) {
                this.$el.addClass('unread');
            } else {
                this.$el.removeClass('unread');
            }
            return this;
        }
    });

    F.NavConversationItemView = F.NavItemView.extend({
        template: 'nav/conversation-item.html',
    });

    F.NavAnnouncementItemView = F.NavItemView.extend({
        template: 'nav/announcement-item.html',
    });

    F.NavPollItemView = F.NavItemView.extend({
        template: 'nav/poll-item.html',
    });

    const NavView = F.ListView.extend({
        template: null, // Abstract
        ItemView: null, // Abstruct
        holder: 'tbody',

        initialize: function() {
            this.events = this.events || {};
            this.events['click tfoot'] = 'onFootClick';
            return F.ListView.prototype.initialize.apply(this, arguments);
        },

        onFootClick: function(e) {
            const visible = this.$('tbody').toggle().is(':visible');
            const $el = this.$('.expander');
            const $text = this.$('span');
            const $icon = $el.find('i');
            if (visible) {
              $icon.removeClass('expand').addClass('compress');
              $text.text("Collapse");
            } else {
              $icon.removeClass('compress').addClass('expand');
              $text.text("Expand");
            }
        }
    });

    F.NavConversationsView = NavView.extend({
        template: 'nav/conversations.html',
        ItemView: F.NavConversationItemView
    });

    F.NavAnnouncementsView = NavView.extend({
        template: 'nav/announcements.html',
        ItemView: F.NavAnnouncementItemView,

        events: {
            'click thead': 'onHeaderClick'
        },

        onHeaderClick: async function(e) {
            new F.AnnouncementComposeView({
                header: "Make announcement yo",
                actions: [{
                    class: 'success green',
                    label: 'Send'}, {
                    class: 'approve blue',
                    label: 'Preview'}, {
                    class: 'deny red',
                    label: 'Close'
                }],
                options: {
                    onApprove: () => this.showPreview()
                }
            }).show();
        },

        showPreview: function() {
          throw new Error('XXX Merge error?');
          // probably needs to be written more good
          //const txt = $('.ini')[0].value;
          //const loc = $('.ui.segment.preview p');
          // XXX const conv = forstadown.inlineConvert(txt, new Set(["body"]));
          //loc.empty();
          //loc.append(conv);
          //return false;
        }
    });

    F.NavPollsView = NavView.extend({
        template: 'nav/polls.html',
        ItemView: F.NavPollItemView,

        events: {
            'click thead': 'onHeaderClick'
        },

        onHeaderClick: async function(e) {
            new F.AnnouncementComposeView({
                header: "Make announcement yo",
                actions: [{
                    class: 'success green',
                    label: 'Send'}, {
                    class: 'approve blue',
                    label: 'Preview'}, {
                    class: 'deny red',
                    label: 'Close'
                }],
                options: {
                    onApprove: () => this.showPreview()
                }
            }).show();
        },

        showPreview: function() {
          throw new Error('XXX Merge error?');
          // probably needs to be written more good
          //const txt = $('.ini')[0].value;
          //const loc = $('.ui.segment.preview p');
          // XXX const conv = forstadown.inlineConvert(txt, new Set(["body"]));
          //loc.empty();
          //loc.append(conv);
          //return false;
        }
    });
})();
