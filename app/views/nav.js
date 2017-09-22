/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.NavItemView = F.View.extend({
        template: 'views/nav-item.html',
        tagName: 'tr',
        className: function() {
            return 'nav-item ' + this.model.get('type');
        },

        events: {
            'click': 'select'
        },

        initialize: function() {
            const changeAttrs = [
                'title',
                'titleFallback',
                'lastMessage',
                'unreadCount',
                'timestamp',
                'distribution',
                'sent'
            ].map(x => 'change:' + x);
            this.listenTo(this.model, changeAttrs.join(' '),
                          _.debounce(this.render.bind(this), 200));
            this.listenTo(this.model, 'remove', this.remove);
        },

        select: function() {
            this.$el.trigger('select', this.model);
        },

        render_attributes: async function() {
            let senderName;
            if (this.model.get('type') === 'announcement') {
                const sender = this.model.get('sender');
                if (sender) {
                    senderName = (await F.ccsm.userLookup(sender)).getName();
                } else {
                    console.warn("Malformed announcement (probably legacy app version)");
                }
            }
            return Object.assign({
                avatarProps: (await this.model.getAvatar()),
                titleNormalized: this.model.getNormalizedTitle(),
                senderName
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$el.toggleClass('unread', !!this.model.get('unreadCount'));
            return this;
        }
    });

    F.NavView = F.ListView.extend({
        template: 'views/nav.html',
        ItemView: F.NavItemView,
        holder: 'tbody',

        initialize: function() {
            this.active = null;
            this.on('added', this.onAdded);
            this.listenTo(this.collection, 'opened', this.onThreadOpened);
            return F.ListView.prototype.initialize.apply(this, arguments);
        },

        onAdded: function(item) {
            if (item.model === this.active) {
                item.$el.addClass('active');
            }
        },

        onThreadOpened: function(thread) {
            this.active = thread;
            const item = this.getItem(thread);
            this.$('.nav-item').removeClass('active');
            if (item) {
                /* Item render is async so it may not exist yet.  onAdded will
                 * deal with it later in that case.. */
                item.$el.addClass('active');
            }
        },

        refreshItemsLoop: async function() {
            while (true) {
                if (!document.hidden && navigator.onLine) {
                    try {
                        await Promise.all(this.getItems().map(x => x.render()));
                    } catch(e) {
                        console.error("Render nav item problem:", e);
                    }
                }
                await F.util.sleep(Math.random() * 30);
            }
        }
    });
})();
