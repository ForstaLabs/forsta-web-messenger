/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};

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

        render_attributes: function() {
            return {
                title: F.emoji.replace_unified(this.model.getTitle()),
                lastMessage: F.emoji.replace_unified(this.model.get('lastMessage') || ''),
                lastMessageTimestamp: this.model.get('timestamp'),
                number: this.model.getNumber(),
                avatar: this.model.getAvatar(),
                unreadCount: this.model.get('unreadCount')
            };
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

    F.NavUserItemView = F.View.extend({
        template: 'nav/user-item.html',
        tagName: 'tr',

        className: function() {
            return 'user-item ' + this.model.cid;
        },

        events: {
            'click': 'select'
        },

        initialize: function() {
            this.listenTo(this.model, 'change', _.debounce(this.render.bind(this), 200));
            this.listenTo(this.model, 'destroy', this.remove); // auto update
            this.listenTo(this.model, 'opened', this.markSelected); // auto update
        },

        markSelected: function() {
            this.$el.addClass('active').siblings('.active').removeClass('active');
        },

        select: function(e) {
            this.markSelected();
            this.$el.trigger('select', this.model);
        }
    });

    F.NavTagItemView = F.View.extend({
        template: 'nav/tag-item.html',
        tagName: 'tr',

        className: function() {
            return 'tag-item ' + this.model.cid;
        },

        events: {
            'click': 'select'
        },

        initialize: function() {
            this.listenTo(this.model, 'change', _.debounce(this.render.bind(this), 200));
            this.listenTo(this.model, 'destroy', this.remove); // auto update
            this.listenTo(this.model, 'opened', this.markSelected); // auto update
        },

        markSelected: function() {
            this.$el.addClass('active').siblings('.active').removeClass('active');
        },

        select: function(e) {
            this.markSelected();
            this.$el.trigger('select', this.model);
        }
    });

    F.NavConversationsView = F.ListView.extend({
        template: 'nav/conversations.html',
        holder: 'tbody',
        itemView: F.NavConversationItemView,

        events: {
            'click thead': 'onHeaderClick',
        },

        initialize: function() {
            F.ListView.prototype.initialize.apply(this, arguments);
            const sortEvents = [
                'add',
                'change:timestamp',
                'change:name',
                'change:number'
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
                    this.$holder.prepend($el);
                } else if (index === this.collection.length - 1) {
                    this.$holder.append($el);
                } else {
                    $el.insertBefore(this.$('.conversation-item')[index+1]);
                }
            }
        },

        onHeaderClick: function(e) {
            this.$('tbody').toggle();
        }
    });

    F.NavUsersView = F.ListView.extend({
        template: 'nav/users.html',
        holder: 'tbody',
        itemView: F.NavUserItemView,

        events: {
            'click thead': 'onHeaderClick',
        },

        initialize: function() {
            F.ListView.prototype.initialize.apply(this, arguments);
            const sortEvents = [
                'add',
                'change:timestamp',
                'change:name',
                'change:number'
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
                    this.$holder.prepend($el);
                } else if (index === this.collection.length - 1) {
                    this.$holder.append($el);
                } else {
                    $el.insertBefore(this.$('.conversation-item')[index+1]);
                }
            }
        },

        onHeaderClick: function(e) {
            this.$('tbody').toggle();
        }
    });

    F.NavTagsView = F.ListView.extend({
        template: 'nav/tags.html',
        holder: 'tbody',
        itemView: F.NavTagItemView,

        events: {
            'click thead': 'onHeaderClick',
        },

        initialize: function() {
            F.ListView.prototype.initialize.apply(this, arguments);
            const sortEvents = [
                'add',
                'change:timestamp',
                'change:name',
                'change:number'
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
                    this.$holder.prepend($el);
                } else if (index === this.collection.length - 1) {
                    this.$holder.append($el);
                } else {
                    $el.insertBefore(this.$('.conversation-item')[index+1]);
                }
            }
        },

        onHeaderClick: function(e) {
            this.$('tbody').toggle();
        }
    });
})();
