// vim: ts=4:sw=4:expandtab
/* global platform */

(function () {
    'use strict';

    self.F = self.F || {};

    F.DefaultThreadView = F.View.extend({
        template: 'views/default-thread.html',
        className: 'thread default'
    });

    F.ThreadView = F.View.extend({

        id: function() {
            return `thread-${this.model.cid}`;
        },

        className: function() {
            return `thread ${this.model.get('type')}`;
        },

        events: {
            'click video': 'initiateVidEvents',
            'dblclick video.targeted' : 'vidFullscreen',
            'loadMore': 'fetchMessages',
            'paste': 'onPaste',
            'drop': 'onDrop',
            'dragover': 'onDragOver',
            'dragenter': 'onDragEnter',
            'dragleave': 'onDragLeave',
        },

        initialize: function(options) {
            this.drag_bucket = new Set();
            var onFocus = function() {
                if (!this.isHidden()) {
                    this.markRead();
                }
            }.bind(this);
            addEventListener('focus', onFocus);
            addEventListener('beforeunload', function () {
                removeEventListener('focus', onFocus);
                this.remove();
                this.model.messages.reset([]);
            }.bind(this));
        },

        installListeners: function() {
            if (this._ev_installed) {
                return;
            }
            this.listenTo(this.model, 'remove', this.onRemove);
            this.listenTo(this.model, 'opened', this.onOpened);
            this.listenTo(this.model, 'closed', this.onClosed);
            this.listenTo(this.model, 'expired', this.onExpired);
            this.listenTo(this.model.messages, 'add', this.onAddMessage);
            this.listenTo(this.model.messages, 'expired', this.onExpiredCollection);
            this._ev_installed = true;
        },

        render_attributes: async function() {
            return Object.assign({
                avatarProps: await this.model.getAvatar(),
                titleNormalized: this.model.getNormalizedTitle()
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            const first = !this._rendered;
            await F.View.prototype.render.call(this);
            if (!first) {
                this.headerView.setElement(this.$('.f-header'));
                this.msgView.setElement(this.$('.f-messages'));
                this.composeView.setElement(this.$('.f-compose'));
                this.asideView.setElement(this.$('aside'));
            } else {
                this.headerView = new F.ThreadHeaderView({
                    el: this.$('.f-header'),
                    model: this.model,
                    threadView: this
                });
                this.msgView = new F.MessageView({
                    collection: this.model.messages,
                    el: this.$('.f-messages')
                });
                this.composeView = new F.ComposeView({
                    el: this.$('.f-compose'),
                    model: this.model
                });
                this.asideView = new F.ThreadAsideView({
                    el: this.$('aside'),
                    model: this.model
                });
                this.listenTo(this.composeView, 'send', this.onSend);
            }
            await Promise.all([
                this.headerView.render(),
                this.msgView.render(),
                this.composeView.render()
            ]);
            this.$dropZone = this.$('.f-dropzone');
            if (first) {
                this.installListeners();
                if (this.model.get('asideExpanded')) {
                    await this.toggleAside(null, /*skipSave*/ true);
                }
            } else {
                this.msgView.scrollRestore();
                this.focusMessageField();
            }
            return this;
        },

        toggleAside: async function(ev, skipSave) {
            const $aside = this.$('aside');
            const $icon = this.$('.f-toggle-aside i');
            const loading = 'icon loading notched circle';
            const expanded = !!$aside.hasClass('expanded');
            if (this._asideRenderTask) {
                clearInterval(this._asideRenderTask);
                this._asideRenderTask = null;
            }
            if (!expanded) {
                const iconsave = $icon.attr('class');
                $icon.attr('class', loading);
                try {
                    await this.asideView.render();
                } finally {
                    $icon.attr('class', iconsave);
                }
                this._asideRenderTask = setInterval(this.asideView.render.bind(this.asideView), 5000);
            }
            $aside.toggleClass('expanded', !expanded);
            if (!skipSave) {
                await this.model.save({asideExpanded: !expanded});
            }
        },

        _dragEventHasFiles: function(ev) {
            return ev.originalEvent.dataTransfer.types.indexOf('Files') !== -1;
        },

        onRemove: function() {
            this.onClosed();
            this.remove();
        },

        onClosed: function(e) {
            this.$('video').each(function() {
                $(this)[0].pause();
            });
            this.unbindVidControls(e);
        },

        initiateVidEvents: function(e) {
            if ($('video.targeted')[0] !== undefined) {
                return;
            }
            let vid = e.target;
            $(vid).addClass('targeted');
            $(document).on('keyup', this.vidKeyboardControls);
            $(document).not(vid).on('click', this.unbindVidControls);
        },

        unbindVidControls: function(e) {
            let vid = $('video.targeted')[0];
            if (e !== undefined && vid !== undefined && vid !== e.target) {
                $(vid).removeClass('targeted');
                $(document).off('keyup', this.vidKeyboardControls);
            }
        },

        vidToggleTargeted: function(e) {
            let clickedOn = e.target;
            clickedOn.tagName === 'VIDEO' ? $(clickedOn).addClass('targeted') :
                $('video.targeted').removeClass('targeted');
        },

        vidFullscreen: function(e) {
            let vid = e.target;
            if (typeof(vid.webkitRequestFullScreen) === typeof(Function)) {
                vid.webkitRequestFullScreen();
            }
        },

        vidKeyboardControls: function(e) {
            let vid = $('video.targeted')[0];
            switch(e.which) {
                case 32:
                    vid.paused ? vid.play() : vid.pause();
                    break;
                case 37:
                    vid.currentTime = vid.currentTime - 5;
                    break;
                case 39:
                    vid.currentTime = vid.currentTime + 5;
                    break;
                case 38:
                    if (vid.volume <= .95) {
                        vid.volume += .05;
                    }
                    else {
                        vid.volume = 1;
                    }
                    break;
                case 40:
                    if (vid.volume >= .05) {
                        vid.volume -= .05;
                    }
                    else {
                        vid.volume = 0;
                    }
                    break;
                case 70:
                    vid.webkitRequestFullScreen();
                    break;
                case 27:
                    vid.exitFullscreen();
                    break;
                default:
                    break;
            }
        },

        onPaste: function(ev) {
            const data = ev.originalEvent.clipboardData;
            if (!data.files.length) {
                return;
            }
            ev.preventDefault();
            this.composeView.fileInput.addFiles(data.files);
            this.focusMessageField(); // Make <enter> key after paste work always.
        },

        onDrop: function(ev) {
            if (!this._dragEventHasFiles(ev)) {
                return;
            }
            ev.preventDefault();
            const data = ev.originalEvent.dataTransfer;
            this.composeView.fileInput.addFiles(data.files);
            if (platform.name !== 'Firefox') {
                this.$dropZone.dimmer('hide');
            }
            this.drag_bucket.clear();
            this.focusMessageField(); // Make <enter> key after drop work always.
        },

        onDragOver: function(ev) {
            if (!this._dragEventHasFiles(ev)) {
                return;
            }
            /* Must prevent default so we can handle drop event ourselves. */
            ev.preventDefault();
        },

        onDragEnter: function(ev) {
            if (!this._dragEventHasFiles(ev) || platform.name === 'Firefox') {
                return;
            }
            this.drag_bucket.add(ev.target);
            if (this.drag_bucket.size === 1) {
                this.$dropZone.dimmer('show');
            }
        },

        onDragLeave: function(ev) {
            if (!this._dragEventHasFiles(ev) || platform.name === 'Firefox') {
                return;
            }
            this.drag_bucket.delete(ev.target);
            if (this.drag_bucket.size === 0) {
                this.$dropZone.dimmer('hide');
            }
        },

        onOpened: function() {
            this.msgView.scrollRestore();
            this.focusMessageField();
            this.model.markRead(); // XXX maybe do this on each message visibility.
        },

        focusMessageField: function() {
            if (!F.util.isTouchDevice) {
                this.composeView.$messageField.focus();
            }
        },

        fetchMessages: async function() {
            const $dimmer = this.$('.f-loading.ui.dimmer');
            $dimmer.dimmer('show');
            try {
                await this.model.fetchMessages();
            } finally {
                $dimmer.dimmer('hide');
            }
        },

        onExpired: function(message) {
            var mine = this.model.messages.get(message.id);
            // XXX Suspect logic here.  Why do we need to make sure it's not the
            // same model as our collection's instance?
            if (mine && mine.cid !== message.cid) {
                mine.trigger('expired', mine);
            }
        },

        onExpiredCollection: function(message) {
            this.model.messages.remove(message.id);
        },

        onAddMessage: function(message) {
            message.setToExpire();
            if (!this.isHidden()) {
                this.markRead(); // XXX use visibility api
            }
        },

        markRead: async function(ev) {
            await this.model.markRead();
        },


        onSend: async function(plain, safe_html, files) {
            this.msgView.scrollTail(/*force*/ true);
            if (this.model.get('left')) {
                await this.model.createMessage({
                    safe_html: '<i class="icon warning sign red"></i>' +
                               'You are not a member of this thread.',
                    type: 'clientOnly'
                });
                return;
            }
            const sender = this.model.sendMessage(plain, safe_html, files);
            /* Visually indicate that we are still uploading content if the send
             * is too slow.  Otherwise avoid the unnecessary UI distraction. */
            const tooSlow = 1;
            const done = await Promise.race([sender, F.util.sleep(tooSlow)]);
            if (done === tooSlow) {
                this.composeView.setLoading(true);
                try {
                    await sender;
                } finally {
                    this.composeView.setLoading(false);
                }
            }
        },

        isHidden: function() {
            return document.hidden || !(this.$el && this.$el.is(":visible"));
        }
    });

    F.ThreadAsideView = F.View.extend({
        template: 'views/thread-aside.html',

        initialize: function(options) {
            const rerenderEvents = [
                'change:title',
                'change:left',
                'change:distribution',
                'change:distributionPretty',
                'change:titleFallback',
                'change:notificationsMute'
            ];
            this.listenTo(this.model, rerenderEvents.join(' '), this.render);
        },

        render_attributes: async function() {
            const ids = await this.model.getMembers();
            const users = await F.ccsm.userDirectoryLookup(ids);
            const members = [];
            const ourDomain = await F.currentUser.getDomain();
            for (const user of users) {
                const domain = await user.getDomain();
                members.push(Object.assign({
                    id: user.id,
                    name: user.getName(),
                    local: ourDomain.id === domain.id,
                    domain: domain.attributes,
                    avatar: await user.getAvatar(),
                    slug: user.getSlug(),
                    fqslug: await user.getFQSlug()
                }, user.attributes));
            }
            return Object.assign({
                members,
                age: Date.now() - this.model.get('started'),
                messageCount: await this.model.messages.totalCount(),
                titleNormalized: this.model.getNormalizedTitle()
            }, F.View.prototype.render_attributes.apply(this, arguments));
        }
    });

    F.ThreadHeaderView = F.View.extend({
        template: 'views/thread-header.html',

        initialize: function(options) {
            this.threadView = options.threadView;
            const rerenderEvents = [
                'change:title',
                'change:left',
                'change:distribution',
                'change:distributionPretty',
                'change:titleFallback'
            ];
            this.listenTo(this.model, rerenderEvents.join(' '), this.render);
            this.listenTo(this.model, 'change:expiration', this.setExpireSelection);
            this.listenTo(this.model, 'change:notificationsMute', this.setNotificationsMute);
        },

        events: {
            'click .f-toggle-aside': 'onToggleAside',
            'click .f-update-thread': 'onUpdateThread',
            'click .f-close-thread': 'onCloseThread',
            'click .f-clear-messages': 'onClearMessages',
            'click .f-leave-thread': 'onLeaveThread',
            'click .f-reset-session': 'onResetSession',
        },

        onToggleAside: async function() {
            await this.threadView.toggleAside();
        },

        render_attributes: async function() {
            return await this.threadView.render_attributes();
        },

        render: async function() {
            await F.View.prototype.render.call(this);
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
            this.$expireDropdown.dropdown('set selected', String(this.getExpireTimer()));
        },

        setNotificationsMute: function() {
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
                header: 'Leave Thread ?',
                content: 'Please confirm that you want to leave this thread.'
            });
            if (confirm) {
                await this.model.leaveThread();
            }
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
                header: 'Clear Messages ?',
                content: 'Please confirm that you want to delete your message ' +
                         'history for this thread.'
            });
            if (confirm) {
                await this.model.destroyMessages();
            }
        },

        onCloseThread: async function(ev) {
            const confirm = await F.util.confirmModal({
                icon: 'window close',
                header: 'Close Thread ?',
                content: 'Please confirm that you want to close this thread.'
            });
            if (confirm) {
                if (!this.model.get('left')) {
                    await this.model.leaveThread();
                }
                await this.model.destroyMessages();
                await this.model.destroy();
            }
        },

        getExpireTimer: function() {
            return this.model.get('expiration') || 0;
        },

    });
})();
