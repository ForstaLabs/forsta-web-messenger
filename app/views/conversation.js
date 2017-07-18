/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.ConversationView = F.View.extend({
        template: 'article/conversation.html',

        className: function() {
            return `conversation ${this.model.get('type')}`;
        },

        id: function() {
            return `conversation-${this.model.cid}`;
        },

        render_attributes: function() {
            return Object.assign({
                group: this.model.get('type') === 'group',
                avatarProps: this.model.getAvatar(),
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        initialize: function(options) {
            this.listenTo(this.model, 'remove', this.onRemove);
            this.listenTo(this.model, 'newmessage', this.addMessage);
            this.listenTo(this.model, 'opened', this.onOpened);
            this.listenTo(this.model, 'closed', this.onClosed);
            this.listenTo(this.model, 'expired', this.onExpired);
            this.listenTo(this.model.messageCollection, 'expired',
                          this.onExpiredCollection);
            this.listenTo(this.model, 'change:expireTimer',
                          this.setExpireSelection.bind(this));
            this.listenTo(this.model, 'change:name change:left', this.render);
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
                this.model.messageCollection.reset([]);
            }.bind(this));
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.msgView = new F.MessageView({
                collection: this.model.messageCollection,
                el: this.$('.f-messages')
            });
            this.composeView = new F.ComposeView({
                el: this.$('.f-compose'),
                model: this.model
            });
            this.listenTo(this.composeView, 'send', this.onSend);
            await Promise.all([this.msgView.render(), this.composeView.render()]);
            this.$dropZone = this.$('.f-dropzone');
            this.$expireDropdown = this.$('.f-expire.ui.dropdown').dropdown({
                onChange: this.onExpireSelection.bind(this)
            });
            this.setExpireSelection();
            return this;
        },

        events: {
            'click .f-update-group': 'onUpdateGroup',
            'click .f-view-members': 'onViewMembers',
            'click .f-close-conversation': 'onCloseConversation',
            'click .f-clear-messages': 'onClearMessages',
            'click .f-leave-group': 'onLeaveGroup',
            'click .f-reset-session': 'onResetSession',
            'click video': 'initiateVidEvents',
            'dblclick video.targeted' : 'vidFullscreen',
            'loadMore': 'fetchMessages',
            'paste': 'onPaste',
            'drop': 'onDrop',
            'dragover': 'onDragOver',
            'dragenter': 'onDragEnter',
            'dragleave': 'onDragLeave'
        },

        _dragEventHasFiles: function(ev) {
            return ev.originalEvent.dataTransfer.types.indexOf('Files') !== -1;
        },

        getExpireTimer: function() {
            return this.model.get('expireTimer') || 0;
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

        setExpireSelection: function() {
            this.$expireDropdown.dropdown('set selected', String(this.getExpireTimer()));
        },

        onExpireSelection: function(val) {
            val = Number(val);
            if (val !== this.getExpireTimer()) {
                this.model.sendExpirationTimerUpdate(val);
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
            this.msgView.loadSavedScrollPosition();
            this.focusMessageField();
            this.model.markRead(); // XXX maybe do this on each message visibility.
        },

        focusMessageField: function() {
            this.composeView.$messageField.focus();
        },

        fetchMessages: async function() {
            await this.model.fetchMessages();
            const unread = this.model.messageCollection.where({unread: 1});
            await Promise.all(unread.map(m => m.fetch()));
        },

        onExpired: function(message) {
            console.log("Collection onExpired");
            var mine = this.model.messageCollection.get(message.id);
            if (mine && mine.cid !== message.cid) {
                console.warn("Mine trigger expired", mine);
                mine.trigger('expired', mine);
            }
        },

        onExpiredCollection: function(message) {
            this.model.messageCollection.remove(message.id);
        },

        addMessage: function(message) {
            this.model.messageCollection.add(message, {merge: true});
            this.model.notify(message);
            message.setToExpire();
            if (!this.isHidden()) {
                this.markRead(); // XXX use visibility api
            }
        },

        onViewMembers: function() {
            const users = F.foundation.getUsers();
            new F.ModalView({
                header: "Group Members",
                content: this.model.get('users').map(x => {
                    const u = users.get(x);
                    return u.get('first_name') + ' ' + u.get('last_name');
                }).join('<br/>')
            }).show();
        },

        markRead: async function(ev) {
            await this.model.markRead();
        },

        onResetSession: async function() {
            await this.model.endSession();
        },

        onLeaveGroup: async function() {
            const confirm = await F.util.confirmModal({
                icon: 'eject',
                header: 'Leave Group ?',
                content: 'Please confirm that you want to leave this conversation.'
            });
            if (confirm) {
                await this.model.leaveGroup();
            }
        },

        onUpdateGroup: function() {
            new F.ModalView({
                header: "Update Group",
                content: 'Not Implemented'
            }).show();
        },

        onClearMessages: async function(ev) {
            const confirm = await F.util.confirmModal({
                icon: 'recycle',
                header: 'Clear Messages ?',
                content: 'Please confirm that you want to delete your message ' +
                         'history for this conversation.'
            });
            if (confirm) {
                await this.model.destroyMessages();
            }
        },

        onCloseConversation: async function(ev) {
            const confirm = await F.util.confirmModal({
                icon: 'window close',
                header: 'Close Conversation ?',
                content: 'Please confirm that you want to close this conversation.'
            });
            if (confirm) {
                if (!this.model.isPrivate() && !this.model.get('left')) {
                    await this.model.leaveGroup();
                }
                await this.model.destroyMessages();
                await this.model.destroy();
            }
        },

        onSend: async function(plain, safe_html, files) {
            if (this.model.get('left')) {
                await this.model.createMessage({
                    safe_html: '<i class="icon warning sign red"></i>' +
                               'You are not a member of this conversation.',
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
            return document.hidden || !this.$el.is(":visible");
        }
    });
})();
