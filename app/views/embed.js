// vim: ts=4:sw=4:expandtab
/* global moment */

(function () {
    'use strict';

    self.F = self.F || {};


    F.EmbedView = F.View.extend({
        el: 'body',

        initialize: function(options) {
            F.foundation.allThreads.on('add remove change:unreadCount',
                                       _.debounce(this.updateUnreadCount.bind(this), 1000));
            this.title = options.title;
            this.to = options.to;
            this.threadId = options.threadId;
            this.call = !!options.call;
            this.allowCalling = this.call || !!options.allowCalling;
            this.forceScreenSharing = !!options.forceScreenSharing;
            this.disableHeader = !!options.disableHeader;
            this.disableCommands = !!options.disableCommands;
            this.disableMessageInfo = !!options.disableMessageInfo;
            this.disableSenderInfo = !!options.disableSenderInfo;
            this.disableRecipientsPrompt = !!options.disableRecipientsPrompt;
            this.beaconExtraUrlParams = options.beaconExtraUrlParams;
            this.conversationToken = options.conversationToken;
        },

        render: async function() {
            this.threadStack = new F.ThreadStack({el: '#f-thread-stack'});
            await this.threadStack.render();
            await F.View.prototype.render.call(this);
        },

        updateUnreadCount: async function() {
            const unread = F.foundation.allThreads.map(m =>
                m.get('unreadCount')).reduce((a, b) => a + b, 0);
            F.router && F.router.setTitleUnread(unread);
            await F.state.put("unreadCount", unread);
        },

        openThreadById: async function(id, skipHistory) {
            return await this.openThread(F.foundation.allThreads.get(id), skipHistory);
        },

        openThread: async function(thread) {
            await this.threadStack.open(thread, {
                disableAside: true,
                allowCalling: this.allowCalling,
                forceScreenSharing: this.forceScreenSharing,
                disableHeader: this.disableHeader,
                disableCommands: this.disableCommands,
                disableMessageInfo: this.disableMessageInfo,
                disableSenderInfo: this.disableSenderInfo,
                disableRecipientsPrompt: this.disableRecipientsPrompt
            });
            await F.state.put('mostRecentThread', thread.id);
        },

        openDefaultThread: async function() {
            let thread;
            const attrs = {title: this.title};
            if (this.threadId) {
                // Must not set property unless it's set..
                attrs.id = this.threadId;
            }
            try {
                if (this.threadId) {
                    thread = await F.foundation.allThreads.getAndRestore(this.threadId);
                    if (!thread) {
                        thread = await F.foundation.allThreads.make(this.to, attrs);
                    }
                } else {
                    thread = await F.foundation.allThreads.ensure(this.to, attrs);
                }
            } catch(e) {
                if (e instanceof ReferenceError) {
                    F.util.confirmModal({
                        header: 'Failed to start thread',
                        size: 'tiny',
                        icon: 'doctor',
                        content: `Something went wrong: <b><samp>${e.message}</samp></b>`,
                        confirm: false,
                        dismiss: false,
                        closable: false
                    });
                }
                return;
            }
            await thread.sendControl({
                control: 'beacon',
                application: 'web-embed',
                url: location.origin + location.pathname,
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                utcOffset: moment().format('Z'),
                language: navigator.language,
                referrer: document.referrer,
                extraUrlParams: this.beaconExtraUrlParams,
                conversationToken: this.conversationToken
            });
            await this.openThread(thread);
            if (this.call) {
                const callMgr = F.calling.getOrCreateManager(thread.id, thread);
                await callMgr.start({autoJoin: true});
            }
        },

        isThreadOpen: function(thread) {
            return this.threadStack.isOpen(thread);
        }
    });
})();
