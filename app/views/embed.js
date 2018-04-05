// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};

    F.ThreadStack = F.View.extend({
        className: 'thread-stack',

        initialize: function() {
            this._views = new Map();
        },

        get: function(thread) {
            return this._views.get(thread);
        },

        open: async function(thread) {
            if (thread && thread === this._opened) {
                this.$el.first().transition('pulse');
                thread.trigger('opened', thread);
                return;
            }
            const $existing = this.$(`#thread-${thread.cid}`);
            if ($existing.length) {
                this.$el.prepend($existing);
            } else {
                const View = {
                    conversation: F.ConversationView,
                    announcement: F.AnnouncementView
                }[thread.get('type')];
                const view = new View({model: thread});
                this.$el.prepend(view.$el);
                await view.render();
                this._views.set(thread, view);
            }
            this.setOpened(thread);
            F.router.setTitleHeading(thread.getNormalizedTitle(/*text*/ true));
            thread.trigger('opened', thread);
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

    F.EmbedView = F.View.extend({
        el: 'body',

        initialize: function() {
            F.foundation.allThreads.on('add remove change:unreadCount',
                                       _.debounce(this.updateUnreadCount.bind(this), 400));
        },

        render: async function() {
            this.threadStack = new F.ThreadStack({el: '#f-thread-stack'});
            await this.threadStack.render();
            await F.View.prototype.render.call(this);
        },

        updateUnreadCount: async function() {
            const unread = F.foundation.allThreads.map(m =>
                m.get('unreadCount')).reduce((a, b) =>
                    a + b, 0);
            F.router && F.router.setTitleUnread(unread);
            await F.state.put("unreadCount", unread);
        },

        openThreadById: async function(id, skipHistory) {
            return await this.openThread(F.foundation.allThreads.get(id), skipHistory);
        },

        _defaultThreadView: null,

        openThread: async function(thread) {
            await this.threadStack.open(thread);
            await F.state.put('mostRecentThread', thread.id);
        },

        openDefaultThread: async function() {
            const urlQuery = new URLSearchParams(location.search);
            const to = urlQuery.get('to') || '@support:forsta';
            const thread = await F.foundation.allThreads.ensure(to);
            await this.openThread(thread);
        },

        isThreadOpen: function(thread) {
            return this.threadStack.isOpen(thread);
        }
    });
})();
