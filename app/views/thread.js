// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.DefaultThreadView = F.View.extend({
        template: 'views/default-thread.html',
        className: 'thread default',

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
            this.disableHeader = options.disableHeader;
        },

        id: function() {
            return `thread-${this.model.cid}`;
        },

        className: function() {
            return `thread ${this.model.get('type')}`;
        },

        render_attributes: async function() {
            return Object.assign({
                avatarProps: await this.model.getAvatar(),
                titleNormalized: this.model.getNormalizedTitle(),
                hasHeader: !this.disableHeader,
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            if (this._rendered) {
                /* Too complicated to support rerender. Guard against it. */
                throw TypeError("Already Rendered");
            }
            await F.View.prototype.render.call(this);
            if (!this.disableHeader) {
                this.asideView = new F.ThreadAsideView({
                    el: this.$('aside'),
                    model: this.model,
                    threadView: this
                });
                this.headerView = new F.ThreadHeaderView({
                    el: this.$('.f-header'),
                    model: this.model,
                    threadView: this,
                    asideView: this.asideView
                });
                await this.headerView.render();
                if (this.model.get('asideExpanded')) {
                    await this.toggleAside(null, /*skipSave*/ true);
                }
            }
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
            await F.View.prototype.render.call(this);
            this.$toggleIcon = this.$('i.f-toggle');
            this.toggleIconBaseClass = this.$toggleIcon.attr('class');
            const expanded = this.asideView.$el.hasClass('expanded');
            this.setToggleIconState(expanded ? 'collapse' : 'expand');
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

        setCallActive: function() {
            if (!this.$callItem) {
                return;  // Not rendered yet, first render handles this.
            }
            const lastActivity = this.model.get('callActive');
            if (lastActivity && Date.now() - lastActivity < 60 * 1000) {
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
                this.$callItem.attr('title', '');
                this.$callItem.find('.f-active').removeClass('icon');
                this.$callItem.find('.f-camera').removeClass('radiate');
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

        onCallClick: async function() {
            const callMgr = F.calling.getOrCreateManager(this.model.id, this.model);
            await callMgr.start();
        },

        onLeaveThread: async function() {
            const confirm = await F.util.confirmModal({
                icon: 'eject',
                size: 'tiny',
                header: 'Leave Thread?',
                content: 'Please confirm that you want to leave this thread.'
            });
            if (confirm) {
                await this.model.leaveThread();
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
