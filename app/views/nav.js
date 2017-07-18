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
            this.listenTo(this.model, 'change:name change:lastMessage change:unread',
                          _.debounce(this.render.bind(this), 400));
            this.listenTo(this.model, 'remove', this.remove);
            this.listenTo(this.model, 'opened', this.markSelected);
            this.timeStampView = new F.TimestampView({brief: true});
        },

        markSelected: function() {
            this.$el.addClass('active').siblings('.active').removeClass('active');
        },

        select: function() {
            this.markSelected();
            this.$el.trigger('select', this.model);
        },

        render_attributes: function() {
            return Object.assign({
                avatarProps: this.model.getAvatar()
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.timeStampView.setElement(this.$('.last-timestamp'));
            this.timeStampView.update();
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
})();
