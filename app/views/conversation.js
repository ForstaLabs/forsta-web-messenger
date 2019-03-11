// vim: ts=4:sw=4:expandtab
/* global platform relay */

(function () {
    'use strict';

    self.F = self.F || {};

    F.ConversationView = F.ThreadView.extend({
        template: 'views/conversation.html',

        events: {
            'click .f-title-display': 'onTitleClick',
            'click .f-title-edit .icon': 'onTitleEditSubmit',
            'keypress .f-title-edit input': 'onTitleEditKeyPress',
            'blur .f-title-edit': 'onTitleEditBlur',
            'paste': 'onPaste',
            'drop': 'onDrop',
            'dragover': 'onDragOver',
            'dragenter': 'onDragEnter',
            'dragleave': 'onDragLeave',
        },

        initialize: function(options) {
            this.drag_bucket = new Set();
            this.onFocus = this._onFocus.bind(this);
            addEventListener('focus', this.onFocus);
            this.allowCalling = options.allowCalling;
            this.forceScreenSharing = options.forceScreenSharing;
            this.disableCommands = options.disableCommands;
            this.disableMessageInfo = options.disableMessageInfo;
            this.disableSenderInfo = options.disableSenderInfo;
            this.disableRecipientsPrompt = options.disableRecipientsPrompt;
            this.onReadMarksChange = _.debounce(this._onReadMarksChange.bind(this), 200);
            F.ThreadView.prototype.initialize.apply(this, arguments);
        },

        render: async function() {
            await F.ThreadView.prototype.render.call(this);
            this.messagesView = new F.MessagesView({
                collection: this.model.messages,
                disableMessageInfo: this.disableMessageInfo,
                disableSenderInfo: this.disableSenderInfo
            });
            this.$('.f-messages').append(this.messagesView.$el);
            this.messagesView.setScrollElement(this.$('.f-messages')[0]);
            this.listenTo(this.messagesView, 'loadmore', this.onLoadMore);
            this.composeView = new F.ComposeView({
                el: this.$('.f-compose'),
                model: this.model,
                allowCalling: this.allowCalling,
                forceScreenSharing: this.forceScreenSharing,
                disableCommands: this.disableCommands,
                disableRecipientsPrompt: this.disableRecipientsPrompt
            });
            this.listenTo(this.composeView, 'send', this.onSend);
            await Promise.all([
                this.messagesView.render(),
                this.composeView.render()
            ]);
            this.$dropZone = this.$('.f-dropzone');
            this.listenTo(this.model, 'opened', this.onOpened);
            this.listenTo(this.model, 'closed', this.onClosed);
            this.listenTo(this.model, 'expired', this.onExpired);
            this.listenTo(this.model, 'change:readMarks', this.onReadMarksChange);
            this.listenTo(this.model, 'pendingMessage', this.onPendingMessage);
            this.listenTo(this.model.messages, 'add', this.onAddMessage);
            this.listenTo(this.model.messages, 'add remove', this.onReadMarksChange);
            const loaded = this.model.messages.length;
            const available = await this.model.messages.totalCount();
            const pageSize = this.model.messages.pageSize;
            if (loaded < Math.min(available, pageSize)) {
                await this.loadMore();
            }
            this.onReadMarksChange();
            return this;
        },

        remove: function() {
            removeEventListener('focus', this.onFocus);
            if (this.messagesView) {
                this.messagesView.remove();
            }
            if (this.composeView) {
                this.composeView.remove();
            }
            return F.ThreadView.prototype.remove.apply(this, arguments);
        },

        onClosed: function(e) {
            for (const video of this.$('video')) {
                video.pause();
            }
        },

        _onFocus: function() {
            // Handle clearing unread messages received when window was hidden, but the
            // thread was open.  Hidden varies from platform to platform so its important
            // that we monitor focus state.
            if (!this.isHidden()) {
                this.model.clearUnread();
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
            await this.model.save({title: threadTitle});
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
            if (!(data.files && data.files.length) || data.types.indexOf('text/html') !== -1) {
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

        onOpened: async function() {
            this.messagesView.scrollRestore();
            this.focusMessageField();
            this.model.clearUnread();
            for (const video of this.$('video[autoplay][muted]')) {
                try {
                    await video.play();
                } catch(e) {
                    console.debug("Ignore video play error:", e);
                }
            }
        },

        focusMessageField: function() {
            if (!F.util.isCoarsePointer()) {
                this.composeView.focusMessageField();
            }
        },

        loadMore: async function() {
            if (this.model.messages.length >= await this.model.messages.totalCount()) {
                return;  // Nothing to fetch
            }
            if (this._loading) {
                console.debug("Debouncing loadMore");
                return;
            }
            this._loading = true;
            try {
                await this.model.fetchMessages();
                const last = this.model.messages.at(-1);
                await this.messagesView.waitAdded(last);
            } finally {
                this._loading = false;
            }
        },

        onLoadMore: async function(messageView) {
            const ctx = messageView.scrollSave();
            await this.loadMore();
            messageView.scrollRestore(ctx);
        },

        onExpired: function(message) {
            var mine = this.model.messages.get(message.id);
            // This is odd, Message gets its own expired event but it might have been
            // triggered on some other Message model (not sure why).  This ensures the
            // expired event is fired on our Message model.
            if (mine && mine.cid !== message.cid) {
                mine.trigger('expired', mine);
            }
        },

        _createReadMarkEl: async function(id) {
            const user = await F.atlas.getContact(id);
            return user && $(`
                <div class="f-read-mark f-avatar f-avatar-image" data-user-id="${id}"
                     title="${user.getName()} has read this far.">
                    <img src="${await user.getAvatarURL()}"/>
                </div>
            `);
        },

        _onReadMarksChange: async function() {
            await F.queueAsync(`read-marks-${this.cid}`, async () => {
                const readMarks = this.model.get('readMarks') || {};
                await Promise.all(Object.entries(readMarks).map(async ([id, sent]) => {
                    // Exact matches are not always possible, so search up till we find
                    // the last message behind or at the mark.
                    const message = this.model.messages.find(m => m.get('sent') <= sent);
                    const recentlySentByThem = this.model.messages.find(m => m.get('sender') === id);
                    let $mark = this.messagesView.$(`.f-read-mark[data-user-id="${id}"]`);
                    if (!message || (recentlySentByThem && recentlySentByThem.get('sent') > sent)) {
                        if ($mark.length) {
                            $mark.addClass('hidden');
                            await F.util.transitionEnd($mark);
                            $mark.remove();
                        }
                        return;
                    }
                    const msgView = this.messagesView.getItem(message);
                    if (!msgView) {
                        return;
                    }
                    if (!$mark.length) {
                        $mark = await this._createReadMarkEl(id);
                    } else if ($mark.data('target') === msgView) {
                        return;
                    }
                    if (!$mark.length) {
                        // Most likely this is an old removed user.
                        return;
                    }
                    $mark.data('target', msgView);
                    msgView.on('render', this.onReadMarksChange);
                    $mark.addClass('hidden');
                    if ($mark[0].isConnected) {
                        await F.util.transitionEnd($mark);
                    }
                    msgView.$('.f-read-marks').prepend($mark);
                    F.util.forceReflow($mark);
                    $mark.removeClass('hidden');
                    await F.util.transitionEnd($mark);
                }));
            });
        },

        onPendingMessage: function(sender) {
            console.info('Pending Message from', sender, " is typing...");
            const $mark = this.messagesView.$(`.f-read-mark[data-user-id="${sender}"]`);
            if (!$mark.length) {
                return; // For now just wait until a read marker adds it to avoid jumping around.
            }
            $mark.addClass('radiate');
            const pendingCnt = $mark.data('pendingCnt') || 0;
            $mark.data('pendingCnt', pendingCnt + 1);
            setTimeout(() => {
                const pendingCnt = $mark.data('pendingCnt');
                $mark.data('pendingCnt', pendingCnt - 1);
                if (pendingCnt === 1) {
                    $mark.removeClass('radiate');
                }
            }, 5000);
        },

        onAddMessage: function(message) {
            message.setToExpire();
            if (message.isUnread() && message.get('incoming') && !this.isHidden()) {
                message.markRead();
            }
        },

        onSend: async function(plain, safe_html, files, mentions) {
            this.messagesView.scrollTail(/*force*/ true);
            if (this.model.get('left')) {
                await this.model.createMessage({
                    safe_html: '<i class="icon warning sign red"></i>' +
                               'You are not a member of this thread.',
                    type: 'clientOnly'
                });
                return;
            }
            await this.model.sendMessage(plain, safe_html, files, {mentions});
            if (mentions) {
                for (const x of await F.atlas.getContacts(mentions)) {
                    F.counters.increment(x, 'mentions');
                }
            }
            for (const x of await this.model.getContacts()) {
                F.counters.increment(x, 'messages-sent');
            }
        }
    });
})();
