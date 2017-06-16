/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};
    window.F = window.F || {};

    Whisper.ExpiredToast = Whisper.ToastView.extend({
        render_attributes: function() {
            return { toastMessage: i18n('expiredWarning') };
        }
    });

    Whisper.BlockedToast = Whisper.ToastView.extend({
        render_attributes: function() {
            return { toastMessage: i18n('unblockToSend') };
        }
    });

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

        setTimer: function(e) {
            var seconds = this.$(e.target).data().seconds;
            if (seconds >= 0) {
                this.model.sendExpirationTimerUpdate(seconds);
            }
        },

        render: function() {
            var seconds = this.model.get('expireTimer');
            if (seconds) {
              var s = Whisper.ExpirationTimerOptions.getAbbreviated(seconds);
              this.$el.attr('data-time', s);
              this.$el.show();
            } else {
              this.$el.attr('data-time', null);
              this.$el.hide();
            }
        }
    });

    F.ConversationView = F.View.extend({
        templateUrl: 'templates/article/conversation.html',

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
                timer_options: Whisper.ExpirationTimerOptions.models
            };
        },

        initialize: function(options) {
            this.listenTo(this.model, 'destroy', this.stopListening);
            this.listenTo(this.model, 'newmessage', this.addMessage);
            this.listenTo(this.model, 'opened', this.onOpened);
            this.listenTo(this.model, 'expired', this.onExpired);
            this.listenTo(this.model.messageCollection, 'expired', this.onExpiredCollection);
            this.dropzone_refcnt = 0;

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
            'select .messages .entry': 'messageDetail',
            'verify-identity': 'verifyIdentity',
            'paste': 'onPaste',
            'drop': 'onDrop',
            'dragover': 'onDragOver',
            'dragenter': 'onDragEnter',
            'dragleave': 'onDragLeave'
        },

        onPaste: function(e) {
            const data = e.originalEvent.clipboardData;
            if (data.types[0] != 'Files') {
                console.warn("Not handling non-file clipboardData:", data);
                return;
            }
            e.preventDefault();
            this.composeView.fileInput.addFiles(data.files);
            this.focusMessageField(); // Make <enter> key after paste work always.
        },

        onDrop: function(e) {
            const data = e.originalEvent.dataTransfer;
            if (data.types[0] != 'Files') {
                console.warn("Not handling non-file dataTransfer:", data);
                return;
            }
            e.preventDefault();
            this.composeView.fileInput.addFiles(data.files);
            this.$dropZone.dimmer('hide');
            this.dropzone_refcnt = 0;
            this.focusMessageField(); // Make <enter> key after drop work always.
        },

        onDragOver: function(e) {
            if (e.originalEvent.dataTransfer.types[0] != 'Files') {
                return;
            }
            /* prevent browser from opening content directly. */
            e.preventDefault();
        },

        onDragEnter: function(e) {
            if (e.originalEvent.dataTransfer.types[0] != 'Files') {
                return;
            }
            this.dropzone_refcnt += 1;
            if (this.dropzone_refcnt === 1) {
                this.$dropZone.dimmer('show');
            }
        },

        onDragLeave: function(e) {
            if (e.originalEvent.dataTransfer.types[0] != 'Files') {
                return;
            }
            this.dropzone_refcnt -= 1;
            if (this.dropzone_refcnt === 0) {
                this.$dropZone.dimmer('hide');
            }
        },

        enableDisappearingMessages: function() {
            if (!this.model.get('expireTimer')) {
                this.model.sendExpirationTimerUpdate(
                    moment.duration(1, 'day').asSeconds()
                );
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

        fetchMessages: function() {
            this.$('.bar-container').show();
            return this.model.fetchContacts().then(function() {
                return this.model.fetchMessages().then(function() {
                    this.$('.bar-container').hide();
                    this.model.messageCollection.where({unread: 1}).forEach(function(m) {
                        m.fetch();
                    });
                }.bind(this));
            }.bind(this));
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

        messageDetail: function(e, data) {
            var view = new F.MessageDetailView({
                model: data.message,
                conversation: this.model
            });
            this.listenBack(view);
            view.render();
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
            this.confirm(i18n('deleteConversationConfirmation')).then(function() {
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
            const tooSlow = 0.500;
            const done = await Promise.race([sender, F.util.sleep(tooSlow)]);
            if (done === tooSlow) {
                this.composeView.setLoading(true);
                await sender;
                this.composeView.setLoading(false);
            }
        },

        isHidden: function() {
            return document.hidden || !this.$el.is(":visible");
        }
    });
})();
