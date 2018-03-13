// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.DefaultThreadView = F.View.extend({
        template: 'views/default-thread.html',
        className: 'thread default',

        events: {
            'click .f-intro-video.button': 'onVideoClick',
        },

        onVideoClick: async function(e) {
            await (new F.IntroVideoView()).show();
        }
    });


    F.ThreadView = F.View.extend({

        id: function() {
            return `thread-${this.model.cid}`;
        },

        className: function() {
            return `thread ${this.model.get('type')}`;
        },

        render_attributes: async function() {
            return Object.assign({
                avatarProps: await this.model.getAvatar(),
                titleNormalized: this.model.getNormalizedTitle()
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            if (this._rendered) {
                /* Too complicated to support rerender. Guard against it. */
                throw TypeError("Already Rendered");
            }
            await F.View.prototype.render.call(this);
            this.headerView = new F.ThreadHeaderView({
                el: this.$('.f-header'),
                model: this.model,
                threadView: this
            });
            this.asideView = new F.ThreadAsideView({
                el: this.$('aside'),
                model: this.model,
                threadView: this
            });
            await this.headerView.render();
            this.listenTo(this.model, 'remove', this.onRemove);
            if (this.model.get('asideExpanded')) {
                await this.toggleAside(null, /*skipSave*/ true);
            }
            return this;
        },

        toggleAside: async function(ev, skipSave) {
            const $aside = this.asideView.$el;
            const expanded = !!$aside.hasClass('expanded');
            if (this._asideRenderTask) {
                clearInterval(this._asideRenderTask);
                this._asideRenderTask = null;
            }
            if (!expanded) {
                this.headerView.setToggleIconState('loading');
                try {
                    await this.asideView.render();
                } finally {
                    this.headerView.setToggleIconState('collapse');
                }
                this._asideRenderTask = setInterval(this.maybeRenderAside.bind(this), 5000);
            } else {
                this.headerView.setToggleIconState('expand');
            }
            $aside.toggleClass('expanded', !expanded);
            if (!skipSave) {
                await this.model.save({asideExpanded: !expanded});
            }
        },

        maybeRenderAside: async function() {
            if (!this.isHidden()) {
                await this.asideView.render();
            }
        },

        _dragEventHasFiles: function(ev) {
            return ev.originalEvent.dataTransfer.types.indexOf('Files') !== -1;
        },

        onRemove: function() {
            this.remove();
        },

        markRead: async function(ev) {
            await this.model.markRead();
        },

        isHidden: function() {
            return document.hidden || !(this.$el && this.$el.is(":visible"));
        }
    });


    F.ThreadAsideView = F.View.extend({
        template: 'views/thread-aside.html',

        events: {
            'click .f-notices .f-clear': 'onClearNotices',
            'click .f-notices .f-close': 'onCloseNotice',
            'click .f-alt-collapse': 'onCollapseClick'
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
            const monModels = await F.atlas.getContacts(await this.model.getMonitors());
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
            }, F.View.prototype.render_attributes.apply(this, arguments));
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
        }
    });


    F.ThreadHeaderView = F.View.extend({
        template: 'views/thread-header.html',
        toggleIconExpand: 'angle double left',
        toggleIconCollapse: 'angle double right',
        toggleIconLoading: 'loading notched circle',

        initialize: function(options) {
            this.threadView = options.threadView;
            const rerenderEvents = [
                'change:title',
                'change:left',
                'change:pendingMembers',
                'change:distribution',
                'change:distributionPretty',
                'change:titleFallback',
                'change:notices'
            ];
            this.listenTo(this.model, rerenderEvents.join(' '), this.render);
            this.listenTo(this.model, 'change:expiration', this.setExpireSelection);
            this.listenTo(this.model, 'change:notificationsMute', this.setNotificationsMute);
        },

        events: {
            'click .f-toggle-aside': 'onToggleAside',
            'click .f-update-thread': 'onUpdateThread',
            'click .f-archive-thread': 'onArchiveThread',
            'click .f-expunge-thread': 'onExpungeThread',
            'click .f-pin-thread' : 'onPinThread',
            'click .f-clear-messages': 'onClearMessages',
            'click .f-leave-thread': 'onLeaveThread',
            'click .f-reset-session': 'onResetSession',
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
                noticeSeverityColor
            }, await this.threadView.render_attributes());
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$toggleIcon = this.$('i.f-toggle');
            this.toggleIconBaseClass = this.$toggleIcon.attr('class');
            const expanded = this.threadView.asideView.$el.hasClass('expanded');
            this.setToggleIconState(expanded ? 'collapse' : 'expand');
            this.$('.ui.dropdown').dropdown();
            this.$notificationsDropdown = this.$('.f-notifications.ui.dropdown').dropdown({
                onChange: this.onNotificationsSelection.bind(this)
            });
            this.$expireDropdown = this.$('.f-expire.ui.dropdown').dropdown({
                onChange: this.onExpireSelection.bind(this)
            });
            this.setExpireSelection();
            this.setNotificationsMute();
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
            const $icon = $el.find('i.icon');
            $icon.removeClass('mute');
            const $toggle = $el.find('[data-value="toggle"]');
            if (muted) {
                $icon.addClass('mute');
                $toggle.html('Enable Notifications');
                const expires = this.model.get('notificationsMute');
                if (typeof expires === 'number') {
                    setTimeout(this.setNotificationsMute.bind(this),
                               (expires - Date.now()) + 1000);
                }
            } else {
                $toggle.html('Disable Notifications');
            }
        },

        onExpireSelection: function(val) {
            const $icon = this.$expireDropdown.find('i.icon');
            val = Number(val);
            if (val) {
                $icon.removeClass('empty').addClass('full');
            } else {
                $icon.removeClass('full').addClass('empty');
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

        onLeaveThread: async function() {
            const confirm = await F.util.confirmModal({
                icon: 'eject',
                header: 'Leave Thread?',
                content: 'Please confirm that you want to leave this thread.'
            });
            if (confirm) {
                await this.model.leaveThread();
            }
            F.util.reportUsageEvent('Thread', 'leave');
        },

        onUpdateThread: function() {
            new F.ModalView({
                header: "Update Thread",
                content: 'Not Implemented'
            }).show();
        },

        onClearMessages: async function(ev) {
            const confirm = await F.util.confirmModal({
                icon: 'recycle',
                header: 'Clear Messages?',
                content: 'Please confirm that you want to delete your message ' +
                         'history for this thread.'
            });
            if (confirm) {
                await this.model.destroyMessages();
                F.util.reportUsageEvent('Thread', 'clear');
            }
        },

        onArchiveThread: async function(ev) {
            await this.model.archive();
            await F.mainView.openDefaultThread();
            F.util.reportUsageEvent('Thread', 'archive');
        },

        onExpungeThread: async function(ev) {
            const confirm = await F.util.confirmModal({
                icon: 'bomb',
                header: 'Expunge Thread?',
                content: 'Please confirm that you want to delete this thread and all its messages.'
            });
            if (confirm) {
                await this.model.expunge();
                await F.mainView.openDefaultThread();
            }
            F.util.reportUsageEvent('Thread', 'expunge');
        },

        onPinThread: async function(ev) {
            const pinned = !this.model.get('pinned');
            await this.model.save('pinned', pinned);
            await this.model.sendUpdate({pinned});
            await this.render();
            F.util.reportUsageEvent('Thread', 'pin');
        },

        getExpireTimer: function() {
            return this.model.get('expiration') || 0;
        },

        setToggleIconState: function(state) {
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
