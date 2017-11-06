// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    let _dragItem;

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
            if (F.util.isTouchDevice) {
                return;
            }
            /* Fix firefox draggable support... */
            ev.originalEvent.dataTransfer.setData('foo', 'bar');
            ev.originalEvent.dataTransfer.effectAllowed = 'move';
            _dragItem = this;
            this.$el.addClass('dragging');
            // This runs after the browser sets the drag-image...
            requestAnimationFrame(() => this.$el.css('max-height', '0'));
        },

        onDragEnd: function(ev) {
            this.$el.css('max-height', '6em');
            this.$el.removeClass('dragging');
            F.mainView.navPinnedView.trigger('dropzonestop');
            F.mainView.navRecentView.trigger('dropzonestop');
            _dragItem = undefined;
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
            if (!F.util.isTouchDevice) {
                this.$el.attr('draggable', 'true');
            }
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
            'drop': '_onDrop'
        },

        initialize: function() {
            this.active = null;
            this.dragBucket = new Set();
            this.on('added', this.onAdded);
            this.on('dropzonestart', this._onDropZoneStart);
            this.on('dropzonestop', this._onDropZoneStop);
            this.listenTo(this.collection, 'opened', this.onThreadOpened);
            return F.ListView.prototype.initialize.apply(this, arguments);
        },

        onDragEnter: function(ev) {
            if (!_dragItem) {
                return;  // Not for us.
            }
            if (!this.dragBucket.size) {
                this.trigger('dropzonestart');
            }
            this.dragBucket.add(ev.target);
        },

        onDragLeave: function(ev) {
            if (!_dragItem) {
                return;  // Not for us.
            }
            this.dragBucket.delete(ev.target);
            if (!this.dragBucket.size) {
                this.trigger('dropzonestop');
            }
        },

        _onDropZoneStart: function() {
            if (this.onDropZoneStart) {
                this.onDropZoneStart();
            }
        },

        _onDropZoneStop: function() {
            this.dragBucket.clear();
            if (this.onDropZoneStop) {
                this.onDropZoneStop();
            }
        },

        _onDrop: function(ev) {
            this.trigger('dropzonestop');
            if (this.onDrop) {
                return this.onDrop(ev);
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
            if (_dragItem && !this.getItem(_dragItem.model)) {
                this.$el.addClass('dropzone');
            }
        },

        onDropZoneStop: function() {
            this.$el.removeClass('dropzone');
        },

        onDragOver: function(ev) {
            if (_dragItem && !this.getItem(_dragItem.model)) {
                // Strangely, preventDefault() is to allow drop events.
                ev.preventDefault();
            }
        },

        onDrop: function(ev) {
            /* Only fired if onDragOver does event.preventDefault. */
            ev.preventDefault(); // Stop any browser behavior..
            const thread = _dragItem.model;
            console.assert(thread.get('pinned'));
            togglePinned(thread);
        }
    });

    F.NavPinnedView = NavView.extend({
        template: 'views/nav-pinned.html',
        className: 'f-nav-view f-pinned',

        onDropZoneStart: function() {
            if (_dragItem) {
                this.$el.addClass('dropzone');
            }
        },

        onDropZoneStop: function() {
            this.$el.removeClass('dropzone');
            this.$('.f-nav-item').removeClass('dropzone-insert-before dropzone-insert-after');
            this._lastDragOverTarget = null;
            this._$lastDragOverItem = null;
        },

        onDragOver: function(ev) {
            if (!_dragItem) {
                return;
            }
            // Strangely, preventDefault() is to allow drop events.
            ev.preventDefault();
            if (ev.target === this._lastDragOverTarget) {
                return;
            }
            this._lastDragOverTarget = ev.target;
            const $dragOver = $(ev.target).closest('.f-nav-item');
            if ($dragOver.is(this._$lastDragOverItem)) {
                return;
            }
            this._$lastDragOverItem = $dragOver;
            this.$('.f-nav-item').removeClass('dropzone-insert-before dropzone-insert-after');
            if (!$dragOver.length) {
                // Probably our header.
                this.$('.f-nav-item').first().addClass('dropzone-insert-before');
            } else {
                $dragOver.addClass('dropzone-insert-after');
            }
        },

        onDrop: function(ev) {
            /* Only fired if onDragOver does event.preventDefault. */
            ev.preventDefault(); // Stop any browser behavior..
            const thread = _dragItem.model;
            let position = 0;
            const $dragOver = $(ev.target).closest('.f-nav-item');
            if (!$dragOver.length) {
                // Probably our header.
                const first = this.collection.at(0);
                position = first ? (first.get('position') || 0) - 1 : 0;
            } else {
                const low = this.collection.get($dragOver.data('model'));
                const lowIndex = this.collection.indexOf(low);
                const high = this.collection.at(lowIndex + 1);
                const lowPos = low.get('position') || 0;
                const highPos = high && high.get('position') || 0;
                if (high === thread) {
                    /* Already in the right spot. */
                    console.log("In the right spot already!");
                    return;
                } else if (high && highPos - lowPos < 2) {
                    /* Reposition higher models to prevent collisions. */
                    for (let i = lowIndex + 1, j = 0; i < this.collection.length; i++, j++) {
                        const model = this.collection.at(i);
                        if (model !== thread) {
                            console.log("Reposition", model, model.get('position'), lowPos + 2 + j);
                            const p = lowPos + 2 + j;
                            const update = {position: p, pinned: true};
                            model.save(update, {silent: true});
                            model.sendUpdate(update, /*sync*/ true);
                        } else {
                            console.log("Skipping renumbering of self, we come soon!");
                        }
                    }
                }
                position = lowPos + 1;
            }
            console.info('DROP!!!!!', position);
            const update = {position, pinned: true};
            thread.save(update);
            thread.sendUpdate(update, /*sync*/ true);
        }
    });
})();
