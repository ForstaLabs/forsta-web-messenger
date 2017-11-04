// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    F.NavItemView = F.View.extend({
        template: 'views/nav-item.html',
        className: function() {
            return 'f-nav-item ' + this.model.get('type');
        },

        events: {
            'click': 'onClick'
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
        },

        onClick: function(ev) {
            if ($(ev.target).is('.f-archive')) {
                this.archiveThread();
            } else if ($(ev.target).is('.f-pin')) {
                this.togglePinned();
            } else {
                this.selectThread();
            }
        },

        selectThread: function() {
            this.$el.trigger('select', this.model);
        },

        archiveThread: async function() {
            await this.model.archive();
            if (F.mainView.isThreadOpen(this.model)) {
                await F.mainView.openDefaultThread();
            }
        },

        togglePinned: async function() {
            const pinned = !this.model.get('pinned');
            await this.model.save({pinned});
            await this.model.sendUpdate({pinned}, /*sync*/ true);
        },

        render_attributes: async function() {
            let senderName;
            if (this.model.get('type') === 'announcement') {
                const sender = this.model.get('sender');
                if (sender) {
                    const user = (await F.ccsm.usersLookup([sender]))[0];
                    if (user) {
                        senderName = user.getName();
                    } else {
                        console.warn("Sender not found:", sender);
                    }
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
            this.$el.attr('draggable', 'true');
            this.$el.toggleClass('unread', !!this.model.get('unreadCount'));
            return this;
        }
    });

    const NavView = F.ListView.extend({
        ItemView: F.NavItemView,
        holder: '.f-nav-items',

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
            $('.f-nav-item').removeClass('active');
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
                await relay.util.sleep(Math.random() * 30);
            }
        }
    });

    F.NavRecentView = NavView.extend({
        template: 'views/nav-recent.html',
        className: 'f-nav-view f-recent',
    });

    F.NavPinnedView = NavView.extend({
        template: 'views/nav-pinned.html',
        className: 'f-nav-view f-pinned',
    });
})();
