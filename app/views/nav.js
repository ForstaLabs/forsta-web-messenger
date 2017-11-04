// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    let _dragging;

    async function togglePinned(thread) {
        const pinned = !thread.get('pinned');
        await thread.save({pinned});
        await thread.sendUpdate({pinned}, /*sync*/ true);
    }

    F.NavItemView = F.View.extend({
        template: 'views/nav-item.html',
        className: function() {
            return 'f-nav-item ' + this.model.get('type');
        },

        events: {
            'click': 'onClick',
            'dragstart': 'onDragStart',
            'dragend': 'onDragEnd'
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
                togglePinned(this.model);
            } else {
                this.selectThread();
            }
        },

        onDragStart: function(ev) {
            _dragging = ev.target;
            _dragging.style.opacity = 0.50;
        },

        onDragEnd: function(ev) {
            _dragging.style.opacity = 1;
            _dragging = undefined;
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

        events: {
            'dragenter': 'onDragEnter',
            'dragleave': 'onDragLeave',
            'dragover': 'onDragOver',
            'drop': 'onDrop',
            'dropzonestart': 'onDropZoneStart',
            'dropzonestop': 'onDropZoneStop',
        },

        initialize: function() {
            this.active = null;
            this.dragEnterCnt = 0;
            this.on('added', this.onAdded);
            this.on('dropzonestart', this.onDropZoneStart);
            this.on('dropzonestop', this.onDropZoneStop);
            this.listenTo(this.collection, 'opened', this.onThreadOpened);
            return F.ListView.prototype.initialize.apply(this, arguments);
        },

        onDragEnter: function(ev) {
            this.dragEnterCnt++;
            if (this.dragEnterCnt === 1) {
                this.trigger('dropzonestart');
            }
        },

        onDragLeave: function(ev) {
            this.dragEnterCnt--;
            if (!this.dragEnterCnt) {
                this.trigger('dropzonestop');
            }
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

        onDropZoneStart: function() {
            if (!this.$(_dragging).length) {
                this.$('.f-nav-items, .f-nav-header').css('filter', 'blur(3px)');
                this.$('.f-nav-dropzone').css('display', 'block');
            }
        },

        onDropZoneStop: function() {
            if (!this.$(_dragging).length) {
                this.$('.f-nav-dropzone').css('display', '');
                this.$('.f-nav-items').css('filter', '');
                this.$('.f-nav-header').css('filter', '');
            }
        },

        onDragOver: function(ev) {
            /* DnD api is crazy...
             * We preventDefault() if we want to allow drop. */
            if (!this.$(_dragging).length) {
                ev.preventDefault();
            }
        },

        onDrop: function(ev) {
            if (!this.$(_dragging).length) {
                ev.preventDefault(); // Stop any browser behavior..
                this.dragEnterCnt = 0;
                this.trigger('dropzonestop');
                const thread = F.foundation.getThreads().get(_dragging.dataset.model);
                console.assert(thread.get('pinned'));
                togglePinned(thread);
            }
        }
    });

    F.NavPinnedView = NavView.extend({
        template: 'views/nav-pinned.html',
        className: 'f-nav-view f-pinned'
    });
})();
