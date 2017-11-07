// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    let _dragItem;

    async function togglePinned(thread) {
        const updates = {pinned: !thread.get('pinned')};
        if (updates.pinned) {
            const last = F.foundation.pinnedThreads.at(-1);
            updates.position = last ? (last.get('position') || 0) + 1 : 0;
        }
        await thread.save(updates);
        await thread.sendUpdate(updates, /*sync*/ true);
    }

    F.NavItemView = F.View.extend({
        template: 'views/nav-item.html',
        className: function() {
            return 'f-nav-item ' + this.model.get('type');
        },

        events: {
            'click': 'onClick',
            'dragstart': 'onDragStart',
            'dragend': 'onDragEnd',
            'touchstart': 'onTouchStart',
            'touchend': 'onTouchEnd',
            'touchcancel': 'onTouchCancel',
            'touchmove': 'onTouchMove'
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
            this.$dimmer = $('#f-nav-panel .ui.dimmer');
            this.$dimmer.on('click', () => {
                this.cancelSecondaryState();
            });
            this.secondaryState = false;  // Used for touch devices presently to negate clicks.
            this.listenTo(this.model, changeAttrs.join(' '),
                          _.debounce(this.render.bind(this), 200));
        },

        onClick: function(ev) {
            if ($(ev.target).is('.f-archive')) {
                this.archiveThread();
                this.cancelSecondaryState();
            } else if ($(ev.target).is('.f-pin')) {
                togglePinned(this.model);
                this.cancelSecondaryState();
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
            if (F.util.isTouchDevice) {
                return;
            }
            this.$el.css('max-height', '6em');
            this.$el.removeClass('dragging');
            F.mainView.navPinnedView.trigger('dropzonestop');
            F.mainView.navRecentView.trigger('dropzonestop');
            _dragItem = undefined;
        },

        onTouchStart: function(ev) {
            if (this._touchTimeout) {
                clearTimeout(this._touchTimeout);
            }
            if (ev.touches.length !== 1 || this.secondaryState) {
                return;
            }
            const touch = ev.touches[0];
            this._touchTimeout = setTimeout(() => {
                this.secondaryState = true;
                this.$el.addClass('touchhold');
                this.$dimmer.addClass('active');
            }, 750);
            this._touchX = touch.screenX;
            this._touchY = touch.screenY;
        },

        onTouchEnd: function(ev) {
            this.cancelTouchHold();
        },

        onTouchMove: function(ev) {
            if (this._touchTimeout) {
                const pixelTolerance = 5;
                if (ev.touches.length === 1) {
                    const touch = ev.touches[0];
                    if (Math.abs(touch.screenX - this._touchX) < pixelTolerance &&
                        Math.abs(touch.screenY - this._touchY) < pixelTolerance) {
                        return;  // Too tiny to care, keep waiting.
                    }
                }
                this.cancelTouchHold();
            }
        },

        onTouchCancel: function(ev) {
            this.cancelTouchHold();
        },

        cancelTouchHold: function() {
            if (this._touchTimeout) {
                clearTimeout(this._touchTimeout);
                this._touchTimeout = null;
            }
        },

        cancelSecondaryState: function() {
            this.secondaryState = false;
            this.$el.removeClass('touchhold');
            this.$dimmer.removeClass('active');
            this.cancelTouchHold();
        },

        selectThread: function() {
            this.$el.trigger('select', this.model);
        },

        archiveThread: async function() {
            this.$el.css('max-height', '0');
            await relay.util.sleep(0.400);
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
            let position;
            const $dragOver = $(ev.target).closest('.f-nav-item');
            /* Next positions are random values between 0 and 1 million.  We have various
             * consensus issues with our other devices and this helps avoid needless
             * repositioning and corruption.  Thread sync may make this obsolete but
             * we need it currently. */
            const nextPos = () => 1000000 * Math.random();
            if (!$dragOver.length) {
                // Probably our header; Insert above current head.
                const head = this.collection.at(0);
                position = (head && head.get('position') || 0) - nextPos();
            } else {
                const low = this.collection.get($dragOver.data('model'));
                const lowPos = low.get('position') || 0;
                const lowIndex = this.collection.indexOf(low);
                const high = this.collection.at(lowIndex + 1);
                let highPos = high && high.get('position') || 0;
                if (high === thread) {
                    return;  // Already in the right spot.
                }
                if (high) {
                    if (highPos <= lowPos) {
                        // Reposition N+1 models (as needed) to resolve collision.
                        highPos = null;
                        for (let i = lowIndex + 1, prevPos = lowPos; i < this.collection.length; i++) {
                            const m = this.collection.at(i);
                            if (m === thread) {
                                console.log("Skipping self");
                                continue;
                            }
                            if (prevPos < (m.get('position') || 0)) {
                                console.assert(highPos !== null, 'highPos was never reset');
                                console.log("No need to continue", prevPos, m.get('position'));
                                break;  // No need to continue.
                            }
                            const adjPos = prevPos + nextPos();
                            if (highPos === null) {
                                // Reset new highPos.
                                highPos = adjPos;
                                console.log("Assigning new high pos");
                            }
                            const update = {position: adjPos, pinned: true};
                            m.save(update);
                            m.sendUpdate(update, /*sync*/ true);
                        }
                    }
                    position = lowPos + (highPos - lowPos) / 2;
                } else {
                    position = lowPos + nextPos();
                }
            }
            const update = {position, pinned: true};
            for (const model of this.collection.models) {
                const viewIndex = this.$('.f-nav-item').index(this._views[model.id].$el);
                console.log(model.get('position'), viewIndex);
            }
            thread.save(update);
            thread.sendUpdate(update, /*sync*/ true);
        }
    });
})();
