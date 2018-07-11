// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};


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
            await this.threadStack.open(thread, {
                disableHeader: true,
                disableAside: true
            });
            await F.state.put('mostRecentThread', thread.id);
        },

        openDefaultThread: async function() {
            const urlQuery = new URLSearchParams(location.search);
            const to = relay.hub.sanitizeTags(urlQuery.get('to') || '@support:forsta.io');
            const title = urlQuery.get('title');
            const thread = await F.foundation.allThreads.ensure(to, {title});
            await this.openThread(thread);
            await thread.sendUpdate({});
        },

        isThreadOpen: function(thread) {
            return this.threadStack.isOpen(thread);
        }
    });
})();
