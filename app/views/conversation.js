// vim: ts=4:sw=4:expandtab
/* global platform relay */

(function () {
    'use strict';

    self.F = self.F || {};

    F.ConversationView = F.ThreadView.extend({
        template: 'views/conversation.html',

        events: {
            'click video': 'initiateVidEvents',
            'click .f-title-display': 'onTitleClick',
            'click .f-title-edit .icon': 'onTitleEditSubmit',
            'keypress .f-title-edit input': 'onTitleEditKeyPress',
            'blur .f-title-edit': 'onTitleEditBlur',
            'dblclick video.targeted' : 'vidFullscreen',
            'loadMore': 'fetchMessages',
            'paste': 'onPaste',
            'drop': 'onDrop',
            'dragover': 'onDragOver',
            'dragenter': 'onDragEnter',
            'dragleave': 'onDragLeave'
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

        render: async function() {
            await F.ThreadView.prototype.render.call(this);
            this.msgView = new F.MessageView({
                collection: this.model.messages,
                el: this.$('.f-messages')
            });
            this.composeView = new F.ComposeView({
                el: this.$('.f-compose'),
                model: this.model
            });
            this.listenTo(this.composeView, 'send', this.onSend);
            await Promise.all([
                this.msgView.render(),
                this.composeView.render()
            ]);
            this.$dropZone = this.$('.f-dropzone');
            this.listenTo(this.model, 'remove', this.onRemove);
            this.listenTo(this.model, 'opened', this.onOpened);
            this.listenTo(this.model, 'closed', this.onClosed);
            this.listenTo(this.model, 'expired', this.onExpired);
            this.listenTo(this.model.messages, 'add', this.onAddMessage);
            this.listenTo(this.model.messages, 'expired', this.onExpiredCollection);
            this.focusMessageField();
            await this.fetchMessages();
            return this;
        },

        onRemove: function() {
            this.onClosed();
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

        onTitleClick: function(ev) {
            this.$('.f-title-display').hide();
            this.$('.f-title-edit').show().find('input').focus();
        },

        onTitleEditSubmit: async function(ev) {
            const $edit = this.$('.f-title-edit');
            const threadTitle = $edit.find('input').val();
            $edit.hide();
            this.$('.f-title-display').show();
            await this.model.sendUpdate({threadTitle});
        },

        onTitleEditKeyPress: function(ev) {
            if (ev.keyCode === /*enter*/ 13) {
                this.onTitleEditSubmit();
                return false;
            }
        },

        onTitleEditBlur: async function(ev) {
            await relay.util.sleep(1);  // Mostly to let click event win
            this.$('.f-title-edit').hide();
            this.$('.f-title-display').show();
        },

        onPaste: function(ev) {
            const data = ev.originalEvent.clipboardData;
            /* Only handle file attachments and ONLY if there isn't an html option.
             * The HTML option may seem wrong (and it might be) but excel on OSX send
             * cell content as an image in addition to html.  We prefer the html over
             * the image content in this case. */
            if (!data.files.length || data.types.indexOf('text/html') !== -1) {
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
            const total = await this.model.messages.totalCount();
            const $dimmer = this.$('.f-loading.ui.dimmer');
            if (this.msgView.$el.children().length < total) {
                $dimmer.addClass('active');
                const _this = this;
                requestAnimationFrame(async function() {
                    try {
                        await _this.model.fetchMessages();
                    } finally {
                        $dimmer.removeClass('active');
                    }
                });
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
            const done = await Promise.race([sender, relay.util.sleep(tooSlow)]);
            if (done === tooSlow) {
                this.composeView.setLoading(true);
                try {
                    await sender;
                } finally {
                    this.composeView.setLoading(false);
                }
            }
        }
    });
})();
