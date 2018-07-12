// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    F.ThreadStack = F.View.extend({
        className: 'thread-stack',

        initialize: function() {
            this._views = new Map();
        },

        get: function(thread) {
            const view = this._views.get(thread);
            if (view) {
                return view;
            }
            // Possible ID based lookup.
            const id = (typeof thread === 'object') ? thread.id : thread;
            if (id) {
                for (const t of this._views.keys()) {
                    if (t.id === id) {
                        return this._views.get(t);
                    }
                }
            }
        },

        open: async function(thread, options) {
            options = options || {};
            if (thread && thread === this._opened) {
                this.$el.first().transition('pulse');
                thread.trigger('opened', thread);
                return;
            }
            let view = this.get(thread);
            if (!view) {
                const View = {
                    conversation: F.ConversationView,
                    announcement: F.AnnouncementView
                }[thread.get('type')];
                view = new View(Object.assign({model: thread}, options));
                await view.render();
                this._views.set(thread, view);
            }
            this.$el.prepend(view.$el);
            this.setOpened(thread);
            F.router.setTitleHeading(thread.getNormalizedTitle(/*text*/ true));
            thread.trigger('opened', thread);
        },

        remove: function(thread) {
            const view = this.get(thread);
            if (view) {
                this._views.delete(view.model);
                view.remove();
            }
        },

        isOpen: function(thread) {
            return this._opened === thread;
        },

        setOpened: function(thread) {
            const changeEvents = [
                'change:title',
                'change:titleFallback',
                'change:distributionPretty'
            ].join(' ');
            if (this._opened) {
                this.stopListening(this._opened, changeEvents, this.onTitleChange);
                this._opened.trigger('closed');
            }
            this._opened = thread;
            if (thread) {
                this.listenTo(thread, changeEvents, this.onTitleChange);
            }
        },

        onTitleChange: function() {
            F.router.setTitleHeading(this._opened.getNormalizedTitle(/*text*/ true));
        }
    });
})();
