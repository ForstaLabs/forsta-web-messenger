// vim: ts=4:sw=4:expandtab
/* global ifrpc */

(function () {
    'use strict';

    self.F = self.F || {};

    const logger = F.log.getLogger('views.thread');


    F.DefaultThreadView = F.View.extend({
        template: 'views/default-thread.html',
        className: 'f-thread-view default',

        events: {
            'click .f-intro-video.button': 'onVideoClick',
            'click .f-import-contacts.button': 'onImportContactsClick',
        },

        onVideoClick: function() {
            F.util.promptModal({
                icon: 'youtube',
                header: 'How to use The Forsta Secure Messaging Platform.',
                content: '<iframe src="https://www.youtube.com/embed/fGpvwwCnsQk" ' +
                                 'frameborder="0" allow="encrypted-media" ' +
                                 'allowfullscreen modestbranding="1" rel="0" ' +
                                 'showinfo="0" style="width: 100%; height: 50vh;"></iframe>',
            });
        },

        onImportContactsClick: async function(ev) {
            $(ev.currentTarget).addClass('loading');
            try {
                await (new F.ImportContactsView()).show();
            } finally {
                $(ev.currentTarget).removeClass('loading');
            }
        }
    });


    F.ThreadView = F.View.extend({

        initialize: function(options) {
            this.disableHeader = !!options.disableHeader;
            this.disableAside = !!options.disableAside;
        },

        id: function() {
            return `thread-${this.model.cid}`;
        },

        className: function() {
            return `f-thread-view ${this.model.get('type')}`;
        },

        render_attributes: async function() {
            return Object.assign({
                avatarProps: await this.model.getAvatar(),
                titleNormalized: this.model.getNormalizedTitle(),
                hasHeader: !this.disableHeader,
                hasAside: !this.disableAside
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            if (this._rendered) {
                /* Too complicated to support rerender. Guard against it. */
                throw TypeError("Already Rendered");
            }
            await F.View.prototype.render.call(this);
            if (!this.disableHeader) {
                this.headerView = new F.ThreadHeaderView({
                    el: this.$('.f-header'),
                    model: this.model,
                    threadView: this
                });
            }
            if (!this.disableAside) {
                this.asideView = new F.ThreadAsideView({
                    el: this.$('aside'),
                    model: this.model,
                    threadView: this
                });
            }
            const subRenders = [];
            if (this.headerView) {
                subRenders.push(this.headerView.render());
            }
            if (this.asideView && this.model.get('asideExpanded')) {
                subRenders.push(this.toggleAside(null, /*skipSave*/ true));
            }
            await Promise.all(subRenders);
            return this;
        },

        remove: function() {
            if (this.headerView) {
                this.headerView.remove();
            }
            if (this.asideView) {
                this.asideView.remove();
            }
            F.View.prototype.remove.apply(this, arguments);
        },

        toggleAside: async function(ev, skipSave) {
            if (this._asideRenderTask) {
                clearInterval(this._asideRenderTask);
                this._asideRenderTask = null;
            }
            const expanded = this.asideView.isExpanded();
            if (!expanded) {
                this.setHeaderAsideIconState('loading');
                try {
                    await this.asideView.render();
                } finally {
                    this.setHeaderAsideIconState('collapse');
                }
                this._asideRenderTask = setInterval(this.maybeRenderAside.bind(this), 5000);
            } else {
                this.setHeaderAsideIconState('expand');
            }
            this.asideView.toggleExpanded(!expanded);
            if (!skipSave) {
                await this.model.save({asideExpanded: !expanded});
            }
        },

        setHeaderAsideIconState: function(state) {
            if (!this.headerView) {
                return;
            }
            this.headerView.setToggleIconState(state);
        },

        maybeRenderAside: async function() {
            if (!this.isHidden()) {
                await this.asideView.render();
            }
        },

        _dragEventHasFiles: function(ev) {
            return ev.originalEvent.dataTransfer.types.indexOf('Files') !== -1;
        },

        isHidden: function() {
            return document.hidden || !(this.$el && this.$el.is(":visible"));
        },

        showDistEditor: async function() {
            F.util.reportUsageEvent('Thread', 'editDist');
            const editor = new F.DistEditorView({model: this.model});
            await editor.render();
            const modal = new F.ModalView({content: editor.$el, size: 'tiny'});
            editor.on('saved', () => modal.hide());
            await modal.show();
        }
    });


    F.ThreadAsideView = F.View.extend({
        template: 'views/thread-aside.html',

        events: {
            'click .f-notices .f-clear': 'onClearNotices',
            'click .f-notices .f-close': 'onCloseNotice',
            'click .f-alt-collapse': 'onCollapseClick',
            'click .f-dist-edit': 'onDistEditClick'
        },

        initialize: function(options) {
            this.threadView = options.threadView;
            const rerenderEvents = [
                'change:title',
                'change:left',
                'change:pendingMembers',
                'change:distribution',
                'change:distributionPretty',
                'change:titleFallback',
                'change:notificationsMute',
                'change:notices'
            ];
            this.listenTo(this.model, rerenderEvents.join(' '), this.render);
        },

        render_attributes: async function() {
            const notices = Array.from(this.model.get('notices') || []);
            for (const x of notices) {
                x.icon = x.icon || 'info circle';
                if (x.className === 'error') {
                    x.cornerIcon = 'red warning circle';
                } else if (x.className === 'warning') {
                    x.cornerIcon = 'orange warning circle';
                } else if (x.className === 'success') {
                    x.cornerIcon = 'green thumbs up';
                }
            }
            const memModels = await this.model.getContacts();
            const members = await Promise.all(memModels.map(async x => Object.assign({
                id: x.id,
                name: x.getName(),
                avatar: await x.getAvatar(),
                tagSlug: x.getTagSlug()
            }, x.attributes)));
            const monModels = (await F.atlas.getContacts(await this.model.getMonitors())).filter(x => x);
            const monitors = await Promise.all(monModels.map(async x => Object.assign({
                id: x.id,
                name: x.getName(),
                avatar: await x.getAvatar(),
                tagSlug: x.getTagSlug()
            }, x.attributes)));
            return Object.assign({
                members,
                monitors,
                age: Date.now() - this.model.get('started'),
                messageCount: await this.model.messages.totalCount(),
                titleNormalized: this.model.getNormalizedTitle(),
                hasNotices: !!notices.length,
                noticesReversed: notices.reverse(),
                dist: await F.util.parseDistribution(this.model.get('distributionPretty'))
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        isExpanded: function() {
            return !!this.$el.hasClass('expanded');
        },

        toggleExpanded: function(expanded) {
            return this.$el.toggleClass('expanded', expanded);
        },

        onCloseNotice: async function(ev) {
            this.model.removeNotice(ev.currentTarget.dataset.id);
            await this.model.save();
        },

        onClearNotices: async function() {
            this.model.set('notices', []);
            await this.model.save();
        },

        onCollapseClick: async function() {
            await this.threadView.toggleAside();
        },

        onDistEditClick: async function() {
            await this.threadView.showDistEditor();
        },
    });


    F.ThreadHeaderView = F.View.extend({
        template: 'views/thread-header.html',
        toggleIconExpand: 'angle double left',
        toggleIconCollapse: 'angle double right',
        toggleIconLoading: 'loading notched circle',

        initialize: function(options) {
            this.threadView = options.threadView;
            this.asideView = options.asideView;
            const rerenderEvents = [
                'change:title',
                'change:left',
                'change:blocked',
                'change:pinned',
                'change:pendingMembers',
                'change:distribution',
                'change:distributionPretty',
                'change:titleFallback',
                'change:notices'
            ];
            this.listenTo(this.model, rerenderEvents.join(' '), this.render);
            this.listenTo(this.model, 'change:expiration', this.setExpireSelection);
            this.listenTo(this.model, 'change:notificationsMute', this.setNotificationsMute);
            this.listenTo(this.model, 'change:callActive', this.setCallActive);
            this.listenTo(this.model.messages, 'reset', this.onMessagesReset);
            this.listenTo(this.model.messages, 'add', this.onMessageAdd);
            this.resendingMessages = new Map();
        },

        events: {
            'click .f-toggle-aside': 'onToggleAside',
            'click .f-archive-thread': 'onArchiveThread',
            'click .f-expunge-thread': 'onExpungeThread',
            'click .f-pin-thread' : 'onPinThread',
            'click .f-clear-messages': 'onClearMessages',
            'click .f-block-messages': 'onBlockMessages',
            'click .f-leave-thread': 'onLeaveThread',
            'click .f-edit-dist': 'onEditDist',
            'click .f-reset-session': 'onResetSession',
            'click .f-call': 'onCallClick',
            'click .f-share': 'onShareClick',
            'click .f-popout': 'onPopoutClick',
        },

        messageResendIfRequired: function(message) {
            const sent = new Set(message.receipts.models.filter(x => x.get('type') === 'sent')
                                                        .map(x => x.get('addr')));
            let resendAddrs;
            if (this.resendingMessages.has(message.id)) {
                resendAddrs = this.resendingMessages.get(message.id).addrs;
            } else {
                resendAddrs = new Set();
            }
            for (const r of message.receipts.models) {
                if (r.get('type') === 'error' &&
                    r.get('name') === 'NetworkError') {
                    const addr = r.get('addr');
                    if (sent.has(addr)) {
                        // The message was sent, so remove this error receipt.
                        r.destroy();  // bg okay
                    } else {
                        resendAddrs.add(addr);
                    }
                }
            }
            if (resendAddrs.size) {
                if (!this.resendingMessages.has(message.id)) {
                    this.resendingMessages.set(message.id, {message, addrs: resendAddrs});
                }
                if (!this._resendActive) {
                    logger.warn("Starting message resend job.");
                    this._resendActive = true;
                    setTimeout(() => this.startMessageResendJob(), 1000);
                }
            }
        },

        startMessageResendJob: async function() {
            let delay = 2;
            try {
                while (this.resendingMessages.size) {
                    await F.util.online();
                    await F.sleep(delay);
                    for (const [id, resend] of Array.from(this.resendingMessages.entries())) {
                        logger.warn(`Attempting resend of message: ${resend.message.id} to ${Array.from(resend.addrs)}`);
                        this.resendingMessages.delete(id);
                        try {
                            await this.model.resendMessage(resend.message, {addrs: Array.from(resend.addrs)});
                        } catch(e) {
                            logger.error("Failed to resend message:", e);
                            // Make sure we retry for the original set of addrs attempted.
                            if (!this.resendingMessages.has(id)) {
                                this.resendingMessages.set(id, resend);
                            } else {
                                // Other resends have been scheduled for this message while we attempted our
                                // last resend, so merge in our addrs to create a superset for the next iteration.
                                const newResend = this.resendingMessages.get(id);
                                for (const x of resend.addrs) {
                                    newResend.add(x);
                                }
                            }
                        }
                    }
                    delay *= 2;
                }
            } finally {
                this._resendActive = false;
            }
        },

        onMessagesReset: async function(messages) {
            await Promise.all(messages.models.map(x => x.fetchRelated()));
            for (const x of messages.models) {
                x.monitorExpiration();
                if (x.isSelfSenderAndDevice()) {
                    this.listenTo(x.receipts, 'add', () => this.messageResendIfRequired(x));
                    this.messageResendIfRequired(x);
                }
            }
        },

        onMessageAdd: async function(message) {
            await message.fetchRelated();
            message.monitorExpiration();
            if (message.isSelfSenderAndDevice()) {
                this.listenTo(message.receipts, 'add', () => this.messageResendIfRequired(message));
                this.messageResendIfRequired(message);
            }
        },

        onToggleAside: async function() {
            await this.threadView.toggleAside();
            F.util.reportUsageEvent('Thread', 'toggleAside');
        },

        render_attributes: async function() {
            const notices = this.model.get('notices') || [];
            let noticeSeverityColor = 'blue';
            for (const x of notices) {
                if (x.className === 'error') {
                    noticeSeverityColor = 'red';
                    break;
                } else if (x.className === 'warning') {
                    noticeSeverityColor = 'orange';
                }
            }
            return Object.assign({
                hasNotices: !!notices.length,
                noticeSeverityColor,
            }, await this.threadView.render_attributes());
        },

        render: async function() {
            this.$toggleIcon = null;
            await F.View.prototype.render.call(this);
            this.$toggleIcon = this.$('i.f-toggle');
            this.toggleIconBaseClass = this.$toggleIcon.attr('class');
            if (this.threadView.asideView) {
                const expanded = this.threadView.asideView.isExpanded();
                this.setToggleIconState(expanded ? 'collapse' : 'expand');
            }
            this.$('.ui.dropdown').dropdown();
            this.$notificationsDropdown = this.$('.f-notifications.ui.dropdown').dropdown({
                onChange: this.onNotificationsSelection.bind(this)
            });
            this.$callItem = this.$('.f-call');
            this.$expireDropdown = this.$('.f-expire.ui.dropdown').dropdown({
                onChange: this.onExpireSelection.bind(this)
            });
            this.setExpireSelection();
            this.setNotificationsMute();
            this.setCallActive();
            return this;
        },

        setExpireSelection: function() {
            if (!this.$expireDropdown) {
                return;  // Not rendered yet, first render handles this.
            }
            this.$expireDropdown.dropdown('set selected', String(this.getExpireTimer()));
        },

        setNotificationsMute: function() {
            if (!this.$notificationsDropdown) {
                return;  // Not rendered yet, first render handles this.
            }
            const muted = this.model.notificationsMuted();
            const $el = this.$notificationsDropdown;
            const $toggle = $el.find('[data-value="toggle"]');
            if (muted) {
                $toggle.html('Enable Notifications');
                const expires = this.model.get('notificationsMute');
                if (typeof expires === 'number') {
                    $el[0].dataset.state = 'snoozed';
                    setTimeout(this.setNotificationsMute.bind(this),
                               (expires - Date.now()) + 1000);
                } else {
                    $el[0].dataset.state = 'disabled';
                }
            } else {
                $el[0].dataset.state = 'enabled';
                $toggle.html('Disable Notifications');
            }
        },

        setCallActive: function() {
            if (!this.$callItem) {
                return;  // Not rendered yet, first render handles this.
            }
            if (this.model.hasRecentCallActivity()) {
                this.$callItem.attr('title', 'A call is active.');
                this.$callItem.find('.f-active').addClass('icon');
                this.$callItem.find('.f-camera').addClass('radiate');
                setTimeout(() => this.setCallActive(), 5000);
                if (!this.$callItem.data('active')) {
                    this.$callItem.data('active', true);
                    this.$callItem.transition('bounce', {silent: true});
                }
            } else {
                this.$callItem.data('active', false);
                this.$callItem.attr('title', 'Start a call with members of this thread');
                this.$callItem.find('.f-active').removeClass('icon');
                this.$callItem.find('.f-camera').removeClass('radiate');
            }
        },

        onExpireSelection: function(val) {
            const $icon = this.$expireDropdown.find('i.icon');
            val = Number(val);
            if (val) {
                $icon.removeClass('empty grey').addClass('full');
            } else {
                $icon.removeClass('full').addClass('empty grey');
            }
            if (val !== this.getExpireTimer()) {
                this.model.sendExpirationUpdate(val);
            }
        },

        onNotificationsSelection: async function(val) {
            let mute;
            if (val === 'toggle') {
                mute = !this.model.notificationsMuted();
            } else if (val) { // can be falsy during clear
                mute = Date.now() + (Number(val) * 1000);
            } else {
                return;
            }
            this.model.set('notificationsMute', mute);
            await this.model.save();
        },

        onResetSession: async function() {
            await this.model.endSession();
        },

        onCallClick: async function() {
            const callMgr = F.calling.getOrCreateManager(this.model.id, this.model);
            await callMgr.start();
        },

        onShareClick: async function() {
            await F.util.shareThreadLink(this.model);
        },

        onPopoutClick: async function() {
            // XXX  Move this to some other place where it can be handled more globally.
            if (!F.popouts) {
                F.popouts = {};
            }
            const id = this.model.id;
            const popout = self.open(`${self.origin}/@surrogate/${id}`, id, 'width=400,height=600');
            const surrogateRPC = ifrpc.init(popout, {peerOrigin: self.origin});
            surrogateRPC.addEventListener('init', async () => {
                logger.info("Starting popout surrogate for thread:", id);
                await surrogateRPC.invokeCommand('set-context', {
                    userId: F.currentUser.id,
                    threadId: id
                });
                logger.info("Surrogate loaded:", id);
            });
            surrogateRPC.addEventListener('thread-save', async threadId => {
                F.assert(threadId === this.model.id);
                await this.model.fetch();
            });
            surrogateRPC.addCommandHandler('message-send', async (msgId, payload, options) => {
                logger.info("Sending message on behalf of surrogate:", payload);
                const outmsg = await F.foundation.getMessageSender().send(payload);
                await this.model.messages.fetchNewer();
                const message = this.model.messages.get(msgId);
                F.assert(message);
                if (!options.ephemeral) {
                    message.watchSend(outmsg);
                    message.receipts.on('add', receipt => {
                        surrogateRPC.triggerEvent('message-receipts-add', msgId, receipt.id);
                    });
                }
            });
            surrogateRPC.addCommandHandler('send-control', async (addrs, data, attachments) => {
                logger.info("Sending control message on behalf of surrogate:", data);
                await this.model.sendControlToAddrs(addrs, data, attachments);
            });
            surrogateRPC.addCommandHandler('sync-read-messages', async reads => {
                logger.info("Syncing read messages on behalf of surrogate:", reads);
                await F.foundation.getMessageSender().syncReadMessages(reads);
            });
            this.model.on('save', () => surrogateRPC.triggerEvent('thread-save', this.model.id));
            this.model.messages.on('add', message => {
                surrogateRPC.triggerEvent('message-add', this.model.id, message.id);
            });
            self.addEventListener('unload', () => popout.close());
            F.popouts[id] = {
                popout,
                surrogateRPC
            };
        },

        onLeaveThread: async function() {
            const confirm = await F.util.confirmModal({
                icon: 'eject',
                size: 'tiny',
                header: 'Leave Thread?',
                content: 'Please confirm that you want to leave this thread.'
            });
            if (confirm) {
                await this.model.leave();
            }
            F.util.reportUsageEvent('Thread', 'leave');
        },

        onEditDist: async function() {
            await this.threadView.showDistEditor();
        },

        onClearMessages: async function(ev) {
            const confirm = await F.util.confirmModal({
                icon: 'recycle',
                size: 'tiny',
                header: 'Clear Messages?',
                content: 'Please confirm that you want to delete your message ' +
                         'history for this thread.'
            });
            if (confirm) {
                await this.model.destroyMessages();
                F.util.reportUsageEvent('Thread', 'clear');
            }
        },

        onBlockMessages: async function(ev) {
            const blocked = !this.model.get('blocked');
            await this.model.save({blocked});
            await this.model.sendUpdate({blocked}, {sync: true});
            F.util.reportUsageEvent('Thread', 'block');
        },

        onArchiveThread: async function(ev) {
            await this.model.archive();
            F.util.reportUsageEvent('Thread', 'archive');
        },

        onExpungeThread: async function(ev) {
            const confirm = await F.util.confirmModal({
                icon: 'bomb',
                size: 'tiny',
                header: 'Expunge Thread?',
                content: 'Please confirm that you want to delete this thread and all its messages.'
            });
            if (confirm) {
                await this.model.expunge();
            }
            F.util.reportUsageEvent('Thread', 'expunge');
        },

        onPinThread: async function(ev) {
            const pinned = !this.model.get('pinned');
            await this.model.save('pinned', pinned);
            await this.model.sendUpdate({pinned}, {sync: true});
            F.util.reportUsageEvent('Thread', 'pin');
        },

        getExpireTimer: function() {
            return this.model.get('expiration') || 0;
        },

        setToggleIconState: function(state) {
            if (!this.$toggleIcon) {
                return;  // not rendered yet
            }
            if (state === 'loading') {
                this.$toggleIcon.attr('class', this.toggleIconBaseClass + ' ' +
                                      this.toggleIconLoading);
            } else if (state === 'expand') {
                this.$toggleIcon.attr('class', this.toggleIconBaseClass + ' ' +
                                      this.toggleIconExpand);
            } else if (state === 'collapse') {
                this.$toggleIcon.attr('class', this.toggleIconBaseClass + ' ' +
                                      this.toggleIconCollapse);
            } else {
                throw new Error('invalid state');
            }
        }
    });
})();
