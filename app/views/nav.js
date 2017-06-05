/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};

    F.NavConversationItemView = F.View.extend({
        templateName: 'f-nav-conversation-item',
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
            this.listenTo(this.model.messageCollection, 'add remove',
                          _.debounce(this.model.updateLastMessage.bind(this.model), 200));
            this.timeStampView = new Whisper.TimestampView({brief: true});
        },

        markSelected: function() {
            this.$el.addClass('active').siblings('.active').removeClass('active');
        },

        select: function(e) {
            this.markSelected();
            this.$el.trigger('select', this.model);
        },

        render: function() {
            this.$el.html(this.template({
                title: this.model.getTitle(),
                lastMessage: this.model.get('lastMessage'),
                lastMessageTimestamp: this.model.get('timestamp'),
                number: this.model.getNumber(),
                avatar: this.model.getAvatar(),
                unreadCount: this.model.get('unreadCount')
            }));
            this.timeStampView.setElement(this.$('.last-timestamp'));
            this.timeStampView.update();

            emoji_util.parse(this.$('.name'));
            emoji_util.parse(this.$('.last-message'));

            var unread = this.model.get('unreadCount');
            if (unread > 0) {
                this.$el.addClass('unread');
            } else {
                this.$el.removeClass('unread');
            }
            return this;
        }

    });

    F.NavConversationView = F.ListView.extend({
        templateName: 'f-nav-conversation',
        holder: 'tbody',
        itemView: F.NavConversationItemView,

        sort: function(conversation) {
            var $el = this.$('.' + conversation.cid);
            if ($el && $el.length > 0) {
                var index = getInboxCollection().indexOf(conversation);
                if (index === this.$holder.index($el)) {
                    return;
                }
                if (index === 0) {
                    this.$holder.prepend($el);
                } else if (index === this.collection.length - 1) {
                    this.$holder.append($el);
                } else {
                    $el.insertBefore(this.$('.conversation-item')[index+1]);
                }
            }
        }
    });
})();
