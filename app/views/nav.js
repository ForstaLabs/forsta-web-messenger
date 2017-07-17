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
            this.listenTo(this.model, 'change', _.debounce(this.render.bind(this), 200));
            this.listenTo(this.model, 'destroy', this.remove); // auto update
            this.listenTo(this.model, 'opened', this.markSelected); // auto update
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

        initialize: function() {
            F.ListView.prototype.initialize.apply(this, arguments);
            const sortEvents = [
                'add',
                'change:timestamp',
                'change:name',
                'change:addr'
            ];
            this.listenTo(this.collection, sortEvents.join(' '), this.sort);
        },

        sort: function(conversation) {
            var $el = this.$('.' + conversation.cid);
            if ($el && $el.length > 0) {
                var index = this.collection.indexOf(conversation);
                if (index === this.$holder.index($el)) {
                    return;
                }
                if (index === 0) {
                    console.log("doing prepend", index);
                    this.$holder.prepend($el);
                } else if (index === this.collection.length - 1) {
                    console.log("doing append", index);
                    this.$holder.append($el);
                } else {
                    console.log("doing insert before ", index);
                    $el.insertBefore(this.$('.conversation-item')[index+1]);
                }
            }
        },

        onHeaderClick: function(e) {
            this.$('tbody').toggle();
        }
    });
})();
