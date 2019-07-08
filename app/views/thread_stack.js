// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};

    F.ThreadStack = F.View.extend({
        className: 'thread-stack',

        initialize: function() {
            this._views = new Map();
            this.$dimmer = this.$('> .ui.dimmer');
        },

        get: function(thread) {
            const view = this._views.get(thread);
            if (view) {
                return view;
            }
            // Possible ID based lookup.
            const id = (thread && typeof thread === 'object') ? thread.id : thread;
            if (id) {
                for (const t of this._views.keys()) {
                    if (t && t.id === id) {
                        return this._views.get(t);
                    }
                }
            }
        },

        open: async function(thread, options) {
            options = options || {};
            if (thread) {
                thread.trigger('opening', thread);
                if (thread === this._opened) {
                    this._views.get(thread).$el.transition('pulse');
                    thread.trigger('opened', thread);
                    return;  // Already opened
                }
            }
            this.closeActive();
            let view = this.get(thread);
            if (!view) {
                if (!thread) {
                    view = new F.DefaultThreadView();
                } else {
                    const View = {
                        conversation: F.ConversationView,
                        announcement: F.AnnouncementView
                    }[thread.get('type')];
                    view = new View(Object.assign({model: thread}, options));
                }
                this.$dimmer.dimmer('show');
                try {
                    await view.render();
                } finally {
                    this.$dimmer.dimmer('hide');
                }
                this._views.set(thread, view);
                this.$el.append(view.$el);
            }
            view.$el.siblings('.f-thread-view').removeClass('active');
            view.$el.addClass('active');
            this.setOpened(thread);
            if (thread) {
                thread.trigger('opened', thread);
                F.router.setTitleHeading(thread.getNormalizedTitle(/*text*/ true));
            } else {
                F.router.setTitleHeading('Welcome');
            }
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

        closeActive: function() {
            if (this._opened) {
                this.stopListening(this._opened);
                this._opened.trigger('closed', this._opened);
                this._opened = null;
            }
        },

        setOpened: function(thread) {
            this.closeActive();
            if (thread) {
                this._opened = thread;
                const changeEvents = [
                    'change:title',
                    'change:titleFallback',
                    'change:distributionPretty'
                ].join(' ');
                this.listenTo(thread, changeEvents, this.onTitleChange);
            }
        },

        onTitleChange: function() {
            F.router.setTitleHeading(this._opened.getNormalizedTitle(/*text*/ true));
        }
    });
})();
