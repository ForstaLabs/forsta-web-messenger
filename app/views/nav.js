/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.NavConversationItemView = F.View.extend({
        template: 'nav/conversation-item.html',
        tagName: 'tr',

        className: function() {
            return 'conversation-item ' + this.model.cid;
        },

        events: {
            'click': 'select'
        },

        initialize: function() {
            const changeAttrs = ['name', 'lastMessage', 'unreadCount', 'timestamp',
                                 'recipients'].map(x => 'change:' + x);
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
                avatarProps: (await this.model.getAvatar())
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

    F.NavConversationsView = F.ListView.extend({
        template: 'nav/conversations.html',
        holder: 'tbody',
        ItemView: F.NavConversationItemView,

        events: {
            'click thead': 'onHeaderClick',
        },

        onHeaderClick: function(e) {
            const visible = this.$('tbody').toggle().is(':visible');
            const icon = this.$('.f-collapse-icon');
            if (visible) {
                icon.removeClass('plus').addClass('minus');
            } else {
                icon.removeClass('minus').addClass('plus');
            }
        }
    });

    F.NavAnnouncementsView = F.ListView.extend({
        template: 'nav/announcements.html',
        holder: 'tbody',
        ItemView: F.NavConversationItemView,

        events: {
            'click thead': 'onHeaderClick',
            'click tfoot': 'onFootClick'
        },

        onHeaderClick: function(e) {
            const visible = this.$('tbody').toggle().is(':visible');
            const icon = this.$('.f-collapse-icon');
            if (visible) {
                icon.removeClass('plus').addClass('minus');
            } else {
                icon.removeClass('minus').addClass('plus');
            }
        },

        onFootClick: function(e) {
            let modalView = new F.ModalView({
                header: "Make announcement yo",
                icon: "announcement big red",
                content: `<div class="f-announcement-compose"></div>`,
                actions: [{
                    class: 'deny red',
                    label: 'Close'
                }],
            });
            let composeView = new F.ComposeView({
                el: this.$('.f-compose')
            });
        }
    });
})();
