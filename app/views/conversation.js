/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};
    window.F = window.F || {};

    const ENTER_KEY = 13;
    const TAB_KEY = 9;
    const mdConv = new showdown.Converter();
    mdConv.setFlavor('github');
    mdConv.setOption('noHeaderId', true);
    mdConv.setOption('ghMentionsLink', '/u/{u}');
    mdConv.setOption('openLinksInNewWindow', true);
    mdConv.setOption('excludeTrailingPunctuationFromURLs', true);

    const md = markdownit({
        html: true, // XXX dangerous
        linkify: true,
        breaks: true,
        typographer: true,
        highlight: function(str, lang) {
            debugger;
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(lang, str, true).value;
                } catch (e) {}
            }
            return ''; // use external default escaping
        }
    });

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
            this.fileInput = new F.FileInputView({
                el: this.$el.find('.f-files')
            });
            this.view = new F.MessageView({
                collection: this.model.messageCollection,
                el: this.$el.find('.f-messages')
            });
            await this.view.render();
            this.$messageField = this.$('.f-compose .f-message');
            this.$dropZone = this.$('.f-dropzone');
            return this;
        },

        events: {
            'input .f-compose .f-message': 'onComposeInput',
            'keydown .f-compose .f-message': 'onComposeKeyDown',
            'click .f-compose .f-send': 'onSendClick',
            'click .f-compose .f-attach': 'onAttachClick',
            'click .destroy': 'destroyMessages', // XXX
            'click .end-session': 'endSession', // XXX
            'click .leave-group': 'leaveGroup', // XXX
            'click .update-group': 'newGroupUpdate', // XXX
            'click .verify-identity': 'verifyIdentity', // XXX
            'click .view-members': 'viewMembers', // XXX
            'click .disappearing-messages': 'enableDisappearingMessages', // XXX
            'focus .f-message': 'messageFocus',
            'blur .f-message': 'messageBlur',
            'loadMore': 'fetchMessages',
            'close .menu': 'closeMenu',
            'select .messages .entry': 'messageDetail',
            'verify-identity': 'verifyIdentity',
            'drop': 'onDrop',
            'dragover': 'onDragOver',
            'dragenter': 'onDragEnter',
            'dragleave': 'onDragLeave'
        },

        onDrop: function(e) {
            if (e.originalEvent.dataTransfer.types[0] != 'Files') {
                return;
            }
            e.preventDefault();
            this.fileInput.addFiles(e.originalEvent.dataTransfer.files);
            this.$dropZone.dimmer('hide');
            this.dropzone_refcnt = 0;
            // Make <enter> key after drop work always.
            this.focusMessageField();
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
            this.view.loadSavedScrollPosition();
            this.focusMessageField();
            this.model.markRead(); // XXX maybe do this on each message visibility.
        },

        focusMessageField: function() {
            this.$messageField.focus();
        },

        messageFocus: function(e) {
            this.$('.f-input').addClass('focused');
        },

        messageBlur: function(e) {
            this.$('.f-input').removeClass('focused');
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

        onSendClick: async function(e) {
            if (this.model.isPrivate() && storage.isBlocked(this.model.id)) {
                const toast = new Whisper.BlockedToast();
                toast.$el.insertAfter(this.$el);
                toast.render();
                return;
            }
            const plain = this.replace_colons(this.$messageField.text().trim());
            const html = mdConv.makeHtml(this.replace_colons(this.$messageField.html().trim()));
            const html2 = md.renderInline(this.replace_colons(this.$messageField.html().trim()));
            console.info('Sending Plain Message: %O', plain);
            console.info('Sending HTML Message: %O', html);
            if (plain.length + html.length > 0 || this.fileInput.hasFiles()) {
                //this.model.sendMessage(plain, html + '<hr/>' + html2, await this.fileInput.getFiles());
                this.model.sendMessage(plain, html, await this.fileInput.getFiles());
                this.fileInput.removeFiles();
                this.$messageField.html("");
                this.focusMessageField();
            }
        },

        onAttachClick: function(e) {
            this.fileInput.openFileChooser();
        },

        focusEnd: function(el) {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        },

        onComposeInput: function(e) {
            const msgdiv = e.currentTarget;
            const dirty = msgdiv.innerHTML;
            const clean = F.util.htmlSanitize(dirty);
            if (clean !== dirty) {
                console.warn("Sanitizing input to:", clean);
                msgdiv.innerHTML = clean;
                this.focusEnd(msgdiv);
            }
        },

        onComposeKeyDown: function(e) {
            const keyCode = e.which || e.keyCode;
            const msgdiv = e.currentTarget;
            if (keyCode === TAB_KEY) {
                msgdiv.innerHTML += '&nbsp;&nbsp;&nbsp;&nbsp;' // XXX Incredibly sophmoric (no cursor awarenes)
                this.focusEnd(msgdiv);
                return false;
            } else if (keyCode === ENTER_KEY && !(e.altKey||e.shiftKey||e.ctrlKey)) {
                if (msgdiv.innerText.split(/```/g).length % 2) {
                    // Normal enter pressed and we are not in literal mode.
                    this.onSendClick();
                    return false; // prevent delegation
                }
            }
        },

        replace_colons: function(str) {
            return str.replace(emoji.rx_colons, function(m) {
                var idx = m.substr(1, m.length-2);
                var val = emoji.map.colons[idx];
                if (val) {
                    return emoji.data[val][0][0];
                } else {
                    return m;
                }
            });
        },

        isHidden: function() {
            return document.hidden || !this.$el.is(":visible");
        }
    });
})();