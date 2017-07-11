/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    var MenuView = Whisper.View.extend({
        toggleMenu: function() {
            this.$('.menu-list').toggle();
        }
    });

    var TimerMenuView = MenuView.extend({
        initialize: function() {
            this.render();
            this.listenTo(this.model, 'change:expireTimer', this.render);
        },

        events: {
          'click button': 'toggleMenu',
          'click li': 'setTimer'
        },

        setTimer: async function(e) {
            var seconds = this.$(e.target).data().seconds;
            if (seconds >= 0) {
                await this.model.sendExpirationTimerUpdate(seconds);
            }
        },

        render: function() {
            var seconds = this.model.get('expireTimer');
            if (seconds) {
              var s = F.ExpirationTimerOptions.getAbbreviated(seconds);
              this.$el.attr('data-time', s);
              this.$el.show();
            } else {
              this.$el.attr('data-time', null);
              this.$el.hide();
            }
        }
    });

    F.ConversationView = F.View.extend({
        template: 'article/conversation.html',

        className: function() {
            return `conversation ${this.model.get('type')}`;
        },

        id: function() {
            return `conversation-${this.model.cid}`;
        },

        render_attributes: function() {
            return {
                group: this.model.get('type') === 'group',
                name: this.model.getName(),
                number: this.model.getNumber(),
                title: this.model.getTitle(),
                avatar: this.model.getAvatar(),
                expireTimer: this.model.get('expireTimer'),
                timer_options: F.ExpirationTimerOptions.models
            };
        },

        initialize: function(options) {
            this.listenTo(this.model, 'destroy', this.stopListening);
            this.listenTo(this.model, 'newmessage', this.addMessage);
            this.listenTo(this.model, 'opened', this.onOpened);
            this.listenTo(this.model, 'expired', this.onExpired);
            this.listenTo(this.model.messageCollection, 'expired',
                          this.onExpiredCollection);
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
            addEventListener('click', function (e) {
                let clickedOn = e.target;
                clickedOn.tagName === 'VIDEO' ? $(clickedOn).addClass('targeted') : 
                    $('video.targeted').removeClass('targeted');
            });
            addEventListener('dblclick', function (e) {
                let vid = $('video.targeted')[0];
                if(vid !== undefined)
                {
                    vid.webkitRequestFullScreen();
                }
            });
            addEventListener('keyup', function (e) {
                let vid = $('video.targeted')[0];
                if(vid !== undefined) {
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
                            if(vid.volume <= .95)
                                vid.volume += .05;
                            else
                                vid.volume = 1;
                            break;
                        case 40:
                            if(vid.volume >= .05)
                                vid.volume -= .05;
                            else
                                vid.volume = 0;
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
                }      
            });
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            // XXX Almost works but requries some menu markup.
            //new TimerMenuView({el: this.$('.f-compose button.f-expire'), model: this.model});
            this.msgView = new F.MessageView({
                collection: this.model.messageCollection,
                el: this.$('.f-messages')
            });
            this.composeView = new F.ComposeView({el: this.$('.f-compose')});
            this.listenTo(this.composeView, 'send', this.onSend);
            await Promise.all([this.msgView.render(), this.composeView.render()]);
            this.$dropZone = this.$('.f-dropzone');
            return this;
        },

        events: {
            'click .destroy': 'destroyMessages', // XXX
            'click .end-session': 'endSession', // XXX
            'click .leave-group': 'leaveGroup', // XXX
            'click .update-group': 'newGroupUpdate', // XXX
            'click .verify-identity': 'verifyIdentity', // XXX
            'click .view-members': 'viewMembers', // XXX
            'click .disappearing-messages': 'enableDisappearingMessages', // XXX
            'loadMore': 'fetchMessages',
            'close .menu': 'closeMenu', // XXX
            'paste': 'onPaste',
            'drop': 'onDrop',
            'dragover': 'onDragOver',
            'dragenter': 'onDragEnter',
            'dragleave': 'onDragLeave'
        },

        _dragEventHasFiles: function(e) {
            return e.originalEvent.dataTransfer.types.indexOf('Files') !== -1;
        },

        onPaste: function(e) {
            const data = e.originalEvent.clipboardData;
            if (!data.files.length) {
                return;
            }
            e.preventDefault();
            this.composeView.fileInput.addFiles(data.files);
            this.focusMessageField(); // Make <enter> key after paste work always.
        },

        onDrop: function(e) {
            if (!this._dragEventHasFiles(e)) {
                return;
            }
            e.preventDefault();
            const data = e.originalEvent.dataTransfer;
            this.composeView.fileInput.addFiles(data.files);
            if (platform.name !== 'Firefox') {
                this.$dropZone.dimmer('hide');
            }
            this.drag_bucket.clear();
            this.focusMessageField(); // Make <enter> key after drop work always.
        },

        onDragOver: function(e) {
            if (!this._dragEventHasFiles(e)) {
                return;
            }
            /* Must prevent default so we can handle drop event ourselves. */
            e.preventDefault();
        },

        onDragEnter: function(e) {
            if (!this._dragEventHasFiles(e) || platform.name === 'Firefox') {
                return;
            }
            this.drag_bucket.add(e.target);
            if (this.drag_bucket.size === 1) {
                this.$dropZone.dimmer('show');
            }
        },

        onDragLeave: function(e) {
            if (!this._dragEventHasFiles(e) || platform.name === 'Firefox') {
                return;
            }
            this.drag_bucket.delete(e.target);
            if (this.drag_bucket.size === 0) {
                this.$dropZone.dimmer('hide');
            }
        },

        enableDisappearingMessages: async function() {
            if (!this.model.get('expireTimer')) {
                const time = moment.duration(1, 'day').asSeconds();
                await this.model.sendExpirationTimerUpdate(time);
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
            await this.model.fetchContacts();
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
            message.setToExpire();

            if (!this.isHidden()) {
                this.markRead();
            }
        },

        viewMembers: function() {
            return this.model.fetchContacts().then(function() {
                var view = new Whisper.GroupMemberList({ model: this.model });
                this.listenBack(view);
            }.bind(this));
        },

        markRead: function(e) {
            this.model.markRead();
        },

        verifyIdentity: function(ev, model) {
            debugger;
            throw new Error("XXX Port this!  Maybe auto-accept if perms are setup so.");
            if (!model && this.model.isPrivate()) {
                model = this.model;
            }
            if (model) {
                var view = new Whisper.KeyVerificationPanelView({
                    model: model
                });
                this.listenBack(view);
            }
        },

        listenBack: function(view) {
            this.panel = view;
            this.$('.main.panel, .header-buttons.right').hide();
            this.$('.back').show();
            view.$el.insertBefore(this.$('.panel'));
        },

        endSession: function() {
            this.model.endSession();
            this.$('.menu-list').hide();
        },

        leaveGroup: function() {
            this.model.leaveGroup();
            this.$('.menu-list').hide();
        },

        newGroupUpdate: function() {
            this.newGroupUpdateView = new Whisper.NewGroupUpdateView({
                model: this.model,
                window: this.window
            });
            this.listenBack(this.newGroupUpdateView);
        },

        destroyMessages: function(e) {
            this.confirm('Permanently delete this conversation?').then(function() {
                this.model.destroyMessages();
                this.remove();
            }.bind(this)).catch(function() {
                // clicked cancel, nothing to do.
            });
            this.$('.menu-list').hide();
        },

        onSend: async function(plain, html, files) {
            const sender = this.model.sendMessage(plain, html, files);
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
