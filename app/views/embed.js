// vim: ts=4:sw=4:expandtab
/* global relay moment */

(function () {
    'use strict';

    self.F = self.F || {};


    F.EmbedView = F.View.extend({
        el: 'body',

        initialize: function() {
            F.foundation.allThreads.on('add remove change:unreadCount',
                                       _.debounce(this.updateUnreadCount.bind(this), 400));
            const urlQuery = new URLSearchParams(location.search);
            this.title = urlQuery.get('title');
            this.to = relay.hub.sanitizeTags(urlQuery.get('to') || '@support:forsta.io');
            this.threadId = urlQuery.get('threadId');
            this.allowCalling = urlQuery.has('allowCalling');
            this.forceScreenSharing = urlQuery.has('forceScreenSharing');
            this.disableCommands = urlQuery.has('disableCommands');
            this.disableMessageInfo = urlQuery.has('disableMessageInfo');
            this.disableSenderInfo = urlQuery.has('disableSenderInfo');
            this.disableRecipientsPrompt = urlQuery.has('disableRecipientsPrompt');
            // Strip redundant and unsafe query values before sending them up in the beacon.
            const urlParamBlacklist = [
                'token',
                'to',
                'first_name',
                'last_name',
                'email',
                'phone',
                'title',
                'threadId',
                'disableCommands',
                'logLevel',
                'disableMessageInfo',
                'disableSenderInfo',
                'disableRecipientsPrompt'
            ];
            this.beaconExtraUrlParams = Array.from(urlQuery.entries())
                                             .filter(([k, v]) => urlParamBlacklist.indexOf(k) === -1)
                                             .reduce((acc, [k, v]) => (acc[k] = v, acc), {});
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

        openThread: async function(thread) {
            await this.threadStack.open(thread, {
                disableHeader: true,
                allowCalling: this.allowCalling,
                forceScreenSharing: this.forceScreenSharing,
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
                thread = await F.foundation.allThreads.ensure(this.to, attrs);
            } catch(e) {
                if (e instanceof ReferenceError) {
                    F.util.confirmModal({
                        header: 'Ouch, we need a Doctor',
                        size: 'tiny',
                        icon: 'doctor',
                        content: `Something is wrong: <b><samp>${e.message}</samp></b>`,
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
                extraUrlParams: this.beaconExtraUrlParams
            });
            await this.openThread(thread);
            await thread.sendUpdate({});  // Legacy beacon.
        },

        isThreadOpen: function(thread) {
            return this.threadStack.isOpen(thread);
        }
    });
})();
