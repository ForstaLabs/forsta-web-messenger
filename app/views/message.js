// vim: ts=4:sw=4:expandtab
/* global relay ResizeObserver */

(function () {
    'use strict';

    self.F = self.F || {};

    let passiveEventOpt;
    (function() {
        class detector {
            static get passive() {
                passiveEventOpt = {passive: true};
            }
        }
        addEventListener("test", null, detector);
    })();

    if (self.$) {
        $.fn.oembed.defaults.onError = function(error, url, provider) {
            F.util.reportWarning('OEmbed Error', {url, provider, error});
        };
        $.fn.oembed.defaults.ajaxOptions.cache = true;
        $.fn.oembed.defaults.apikeys = {amazon: 'forsta-20'};
        $.fn.oembed.defaults.maxWidth = 360;
        $.fn.oembed.defaults.maxHeight = 250;
    }

    const TimerView = F.View.extend({
        className: 'timer',

        initialize: function() {
            if (this.model.isExpiring()) {
                this.render();
                const totalTime = this.model.get('expiration') * 1000;
                const remainingTime = this.model.msTilExpire();
                const elapsed = (totalTime - remainingTime) / totalTime;
                this.$el.append('<span class="hourglass"><span class="sand"></span></span>');
                this.$('.sand')
                    .css('animation-duration', remainingTime * 0.001 + 's')
                    .css('transform', 'translateY(' + elapsed * 100 + '%)');
                this.$el.css('display', 'inline-block');
            }
            return this;
        }
    });

    F.MessageItemView = F.View.extend({
        template: 'views/message-item.html',
        className: 'f-message-item event',

        id: function() {
            return 'message-item-view-' + this.model.cid;
        },

        initialize: function(options) {
            this.disableMessageInfo = options.listView.disableMessageInfo;
            this.disableSenderInfo = options.listView.disableSenderInfo;
            const listen = (events, cb) => this.listenTo(this.model, events, cb);
            listen('change:html change:plain change:flags', this.render);
            listen('change:expirationStart', this.renderExpiring);
            listen('remove', this.onRemove);
            listen('expired', this.onExpired);
            this.listenTo(this.model.receipts, 'add', this.onReceipt);
            this.listenTo(this.model.replies, 'add', this.render);
            this.listenTo(this.model.replies, 'change:score', this.render);
        },

        events: {
            'click .f-details-toggle': 'onDetailsToggle',
            'click .f-status': 'onDetailsToggle',
            'click .f-display-toggle': 'onDisplayToggle',
            'click .f-reply': 'onReplyClick',
            'click .f-emoji-toggle': 'onEmojiToggle',
            'click .f-reply-send': 'onReplySendClick',
            'click .f-up-vote': 'onUpVoteClick',
            'click video': 'onVideoClick',
            'click .f-video-wrap': 'onVideoClick',
            'click .f-message-actions .button': 'onActionClick',
            'keyup .f-inline-reply input': 'onReplyKeyUp'
        },

        render_attributes: async function() {
            let avatar;
            let senderName;
            if (!this.model.get('sender') && this.model.isClientOnly()) {
                avatar = {
                    color: 'black',
                    url: F.util.versionedURL(F.urls.static + 'images/icon_256.png')
                };
                senderName = 'Forsta';
            } else {
                const sender = await this.model.getSender();
                senderName = sender.getName();
                avatar = await sender.getAvatar({nolink: this.disableSenderInfo});
            }
            const attrs = F.View.prototype.render_attributes.call(this);
            const replies = await Promise.all(this.model.replies.map(async reply => {
                const sender = await reply.getSender();
                return Object.assign({
                    senderName: sender.getName(),
                    senderInitials: sender.getInitials(),
                    avatar: await sender.getAvatar({nolink: this.disableSenderInfo})
                }, reply.attributes);
            }));
            let actions = this.model.get('actions');
            if (actions) {
                actions = actions.map(x => Object.assign({
                    isDark: !!(x.color && this.cssColorBrightness(x.color) < 0.5),
                }, x));
            }
            return Object.assign(attrs, {
                senderName,
                mobile: this.getMobile(),
                avatar,
                meta: this.model.getMeta(),
                replies,
                safe_html: attrs.safe_html && F.emoji.replace_unified(attrs.safe_html),
                actions,
                disableMessageInfo: this.disableMessageInfo,
                disableSenderInfo: this.disableSenderInfo
            });
        },

        getMobile: function() {
            const userAgent = this.model.get('userAgent') || '';
            if (userAgent.match(new RegExp(F.product))) {
                if (userAgent.match(/Mobile/)) {
                    return `${userAgent.split(/\s/)[0]} (Mobile)`;
                }
            } else if (userAgent.match(/(iPhone|Android)/)) {
                return userAgent.split(/\s/)[0];
            }
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            if (this.emojiPicker) {
                this.emojiPicker.remove();
                this.emojiPopup.remove();
                this.emojiPicker = this.emojiPopup = null;
            }
            if (!this.timestampViews) {
                this.timestampViews = this.$('[data-timestamp]').map((i, el) => new F.ExtendedTimestampView({el}));
            }
            for (const view of this.timestampViews) {
                view.update();
            }
            this.renderEmbed();
            this.renderPlainEmoji();
            this.renderExpiring();
            this.renderTags();
            this.regulateVideos();
            this.renderStatus();
            this.renderActions();
            await this.loadAttachments();
            return this;
        },

        onReceipt: function(receipt) {
            this.renderStatus();
        },

        renderStatus: function() {
            if (this.hasErrors()) {
                this.setStatus('error', /*prio*/ 100, 'A problem was detected');
                return;
            }
            if (this.model.get('incoming') || this.model.get('type') === 'clientOnly') {
                return;
            }
            if (this.isDelivered()) {
                this.setStatus('delivered', /*prio*/ 50, 'Delivered');
            } else if (this.hasPending()) {
                this.setStatus('pending', /*prio*/ 25, 'Pending');
            } else if (this.isSent()) {
                this.setStatus('sent', /*prio*/ 10, 'Sent (awaiting delivery)');
            } else {
                this.setStatus('sending', /*prio*/ 5, 'Sending');
            }
        },

        renderActions: function() {
            // Don't allow the css color to be injected into the template via render_attributes
            // where it could perform injection attacks.
            const actions = this.model.get('actions');
            if (actions && actions.length) {
                const els = this.$('.f-message-actions .ui.button');
                for (let i = 0; i < actions.length; i++) {
                    if (actions[i].color) {
                        els[i].style.backgroundColor = actions[i].color;
                    }
                }
            }
        },

        cssColorBrightness: function(cssColor) {
            // See: https://www.w3.org/TR/AERT/#color-contrast
            if (!this._cssColorToRGBCanvasCtx) {
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 1;
                this._cssColorToRGBCanvasCtx = canvas.getContext('2d');
            }
            const ctx = this._cssColorToRGBCanvasCtx;
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = cssColor;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            return ((r * 0.299) + (g * 0.587) + (b * 0.114)) / 255;
        },

        hasErrors: function() {
            return this.model.receipts.any({type: 'error'});
        },

        hasPending: function() {
            const pendingMembers = this.model.get('pendingMembers');
            return !!(pendingMembers && pendingMembers.length);
        },

        isDelivered: function() {
            /* Returns true if at least one device for each of the recipients has sent a
             * delivery reciept. */
            if (this.model.get('incoming') ||
                this.model.get('type') === 'clientOnly' ||
                this.hasPending()) {
                return false;
            }
            return this._hasAllReceipts('delivery');
        },

        isSent: function() {
            /* Returns true when all recipients in this thread have been sent to. */
            if (this.model.get('incoming') || this.model.get('type') === 'clientOnly') {
                return false;
            } else if (this.model.get('senderDevice') !== F.currentDevice) {
                return true;  // We can't know any better.
            } else {
                return this._hasAllReceipts('sent');
            }
        },

        _hasAllReceipts: function(type) {
            let members = new F.util.ESet(this.model.get('members'));
            members.delete(F.currentUser.id);
            members = members.difference(new Set(this.model.get('pendingMembers') || []));
            const receipts = new Set(this.model.receipts.where({type}).map(x => x.get('addr')));
            return !members.difference(receipts).size;
        },

        onExpired: function() {
            this.model._expiring = true; // Prevent removal in onRemove.
            /* NOTE: Must use force-repaint for consistent rendering and timing. */
            this.$el
                .transition('force repaint')
                .transition('shake')
                .transition('fade out', this.remove.bind(this));
        },

        onRemove: function() {
            if (this.model._expiring) {
                return;
            }
            this.remove();
        },

        remove: function() {
            if (this._detailsView) {
                clearInterval(this._detailsView._refreshId);
                this._detailsView.remove();
            }
            return F.View.prototype.remove.apply(this, arguments);
        },

        onDetailsToggle: async function(ev) {
            const $toggleIcon = this.$('.f-details-toggle');
            const loadingIcon = 'loading notched circle';
            const expandIcon = 'zoom';
            const contractIcon = 'zoom out';
            if (!this._detailsView) {
                $toggleIcon.removeClass(expandIcon + ' ' + contractIcon).addClass(loadingIcon);
                const view = new F.MessageDetailsView({
                    messageView: this,
                    model: this.model,
                });
                this._detailsView = view; // Assign early but use local var for tuning to avoid races.
                await view.render();
                const $holder = this.$('.f-message-details-holder');
                view._minWidth = `${$holder.width()}px`;
                /* Set starting point for animation (smoother) */
                view.$el.css({
                    transition: 'initial',
                    maxHeight: '0',
                    maxWidth: view._minWidth
                });
                $holder.append(view.$el);
                // Perform transition after first layout to avoid render engine dedup.
                requestAnimationFrame(() => {
                    $toggleIcon.removeClass(`${loadingIcon} ${expandIcon}`).addClass(contractIcon);
                    view.$el.css({
                        transition: 'max-height 300ms ease-in, max-width 300ms ease-in',
                        maxHeight: '100vh',
                        maxWidth: '100vw'
                    });
                    // NOTE: 2000ms is a special value; This matches the `loading`
                    // animations from semantic to avoid jaring animation restarts.
                    const animationCycle = 2000;
                    view._refreshId = setInterval(view.render.bind(view), animationCycle * 4);
                });
            } else {
                const view = this._detailsView;
                clearInterval(view._refreshId);
                this._detailsView = null;
                /* Set starting point for animation (smoother) */
                view.$el.css({
                    transition: 'initial',
                    maxHeight: `${view.$el.height()}px`,
                    maxWidth: `${view.$el.width()}px`
                });
                // Perform transition after first layout to avoid render engine dedup.
                const duration = 300;
                requestAnimationFrame(() => {
                    $toggleIcon.removeClass(`${loadingIcon} ${contractIcon}`).addClass(expandIcon);
                    view.$el.css({
                        transition: `max-height ${duration}ms ease-out, max-width ${duration}ms ease-out`,
                        maxHeight: '0',
                        maxWidth: view._minWidth
                    });
                    /* Wait until just after CSS transition finishes to remove the view */
                    relay.util.sleep((duration + 50) / 1000).then(() => view.remove());
                });
            }
        },

        setStatus: function(status, prio, tooltip) {
            if ((this.statusPrio || 0) > prio) {
                return; // Ignore lower prio status updates.
            }
            this.statusPrio = prio;
            this.status = status;
            const icons = {
                error: 'warning circle red',
                sending: 'notched circle loading',
                pending: 'wait',
                sent: 'radio',
                delivered: 'check circle outline',
            };
            const icon = icons[this.status];
            console.assert(icon, `No icon for status: ${this.status}`);
            this.$('.f-status i').attr('class', `icon link ${icon}`).attr('title', tooltip);
        },

        renderEmbed: function() {
            // Oembed is very buggy, don't let it spoil our party.. (eg break the entire convo)
            try {
                this.$('.extra.text a[type="unfurlable"]').oembed(null, {
                    onEmbed: data => {
                        const $segment = $('<div class="f-unfurled ui segment basic">');
                        $segment.html(data.code);
                        if ($segment.html()) {
                            $segment.find('a[href]').attr('target', '_blank');
                            this.$('.f-message-content').after($segment);
                        } else {
                            console.warn("Unfurled content empty");
                        }
                    }});
            } catch(e) {
                console.error("OEmbed Error:", e);
            }
        },

        renderTags: function() {
            for (const el of this.$('.extra.text [f-type="tag"][for]')) {
                el.setAttribute('data-tag-card', el.getAttribute('for'));
            }
        },

        renderPlainEmoji: function() {
            /* We don't want to render plain as html so this safely replaces unicode emojis
             * with html after handlebars has scrubbed the input. */
            const plain = this.$('.extra.text.plain')[0];
            if (plain) {
                plain.innerHTML = F.emoji.replace_unified(plain.textContent);
            }
        },

        renderExpiring: function() {
            new TimerView({
                model: this.model,
                el: this.$('.icon-bar .timer')
            });
        },

        loadAttachments: async function() {
            const $elements = [];
            const attachments = this.model.get('attachments') || [];
            for (const x of attachments) {
                const view = new F.AttachmentView({attachment: x, message: this.model});
                await view.render();
                $elements.push(view.$el);
            }
            this.$('.attachments').append($elements);
        },

        onDisplayToggle: function(ev) {
            const $section = this.$('section');
            const $minIcon = this.$('.f-display-toggle.minimize');
            const $maxIcon = this.$('.f-display-toggle.maximize');
            if ($section.height()) {
                this.model.save({minimized: true});
                $section.css({
                    transition: 'initial',
                    maxHeight: $section.height()
                });
                requestAnimationFrame(() => {
                    $section.css({
                        overflow: 'hidden',
                        transition: '',
                        maxHeight: '0'
                    });
                    $minIcon.hide();
                    $maxIcon.show();
                });
            } else {
                this.model.save({minimized: false});
                $section.css({
                    overflow: '',
                    transition: '',
                    maxHeight: ''
                });
                $maxIcon.hide();
                $minIcon.show();
            }
        },

        regulateVideos: function() {
            const $looping = this.$('video[loop]');
            $looping.on('playing', ev => {
                // Event fired for each playback
                const video = ev.currentTarget;
                video.playCount = (video.playCount || 0) + 1;
                const totalDuration = (video.duration || 0) * (video.playCount - 1);
                if (video.playCount > 10 || totalDuration >= 30) {
                    video.pause();
                }
            }).on('play', ev => {
                // Event fired ONLY for pause->play transition
                const video = ev.currentTarget;
                const $video = $(video);
                const $wrap = $video.parent('.f-video-wrap');
                if ($wrap.length) {
                    $wrap.removeClass('paused');
                }
                video.playCount = 0;
            }).on('pause', ev => {
                // Event fired ONLY for play->pause transition
                const $video = $(ev.currentTarget);
                const $wrap = $video.parent('.f-video-wrap');
                if ($wrap.length) {
                    $wrap.addClass('paused');
                } else {
                    $video.wrap('<div class="f-video-wrap paused"></div>');
                }
            });
        },

        onVideoClick: async function(ev) {
            ev.stopPropagation();
            let $video;
            if (ev.currentTarget.nodeName === 'VIDEO') {
                $video = $(ev.currentTarget);
            } else {
                $video = $(ev.currentTarget).children('video');
            }
            const video = $video[0];
            if (video.paused) {
                try {
                    await video.play();
                } catch(e) {
                    console.warn("Ignore browser video play restriction:", e);
                }
            } else {
                video.pause();
            }
        },

        onActionClick: async function(ev) {
            const action = ev.currentTarget.dataset.action;
            await this.sendReply(null, {data: {action}}, {ephemeral: true});
            await this.model.save("action", action);
            await this.render();
        },

        onReplyClick: async function(ev) {
            const $el = this.$('.f-inline-reply');
            const isVisible = $el.toggleClass('visible').hasClass('visible');
            if (!isVisible) {
                return;
            }
            if (!this.emojiPicker) {
                this.emojiPicker = new F.EmojiPicker();
                this.emojiPicker.on('select', this.onEmojiSelect.bind(this));
                this.emojiPopup = new F.PopupView({anchorEl: this.$('.f-emoji-toggle')[0]});
                this.emojiPopup.$el.append(this.emojiPicker.$el).addClass('ui segment raised');
            }
            await F.util.transitionEnd($el);
            $el.find('.ui.input input').focus();
        },

        onEmojiToggle: async function(ev) {
            ev.stopPropagation();  // Debounce clickaway handling.
            await this.emojiPicker.render();
            await this.emojiPopup.show();
        },

        onEmojiSelect: async function(emoji) {
            const emojiCode = F.emoji.colons_to_unicode(`:${emoji.short_name}:`);
            this.emojiPopup.hide();
            await this.sendReply(emojiCode);
        },

        onReplySendClick: async function() {
            const text = this.$('.f-inline-reply .ui.input input').val();
            if (text) {
                await this.sendReply(text);
            }
        },

        onUpVoteClick: async function(ev) {
            const id = $(ev.currentTarget).closest('.reply').data('id');
            const thread = await this.model.getThread();
            await thread.sendMessage(null, null, null, {messageRef: id, vote: 1});
        },

        onReplyKeyUp: function(ev) {
            const keyCode = ev.which || ev.keyCode;
            if (keyCode === /*Enter*/ 13) {
                this.onReplySendClick();
            }
        },

        sendReply: async function(text, attrs, options) {
            attrs = Object.assign({
                messageRef: this.model.id
            }, attrs);
            const $uiInput = this.$('.f-inline-reply .ui.input');
            const $input = $uiInput.find('input');
            $uiInput.addClass('loading');
            try {
                const thread = await this.model.getThread();
                await thread.sendMessage(text, null, null, attrs, options);
            } finally {
                $input.val('');
                $uiInput.removeClass('loading');
                this.$('.f-inline-reply').removeClass('visible');
            }
        }
    });

    F.MessageDetailsView = F.View.extend({
        template: 'views/message-details.html',
        class: 'f-message-details',

        initialize: function(options) {
            this.thread = F.foundation.allThreads.get(this.model.get('threadId'));
            this.messageView = options.messageView;
        },

        events: {
            'click .f-purge': 'purgeMessage',
            'click .f-copy': 'copyMessage'
        },

        purgeMessage: async function() {
            await F.util.confirmModal({
                icon: 'trash red',
                header: "Delete this message?",
                content: "Please confirm you wish to delete the local copy of this message.",
                confirmClass: 'red',
                confirmLabel: 'Delete'
            }) && this.model.destroy();
        },

        copyMessage: function(ev) {
            const range = document.createRange();
            const $btn = this.$('.f-copy');
            const $content = this.messageView.$('.f-message-content');
            if (!$content.length) {
                $btn.find('span').html("Nothing to copy!");
            } else {
                range.selectNodeContents($content[0]);
                const selection = getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                const ok = document.execCommand('copy');
                selection.removeAllRanges();
                if (ok) {
                    $btn.find('span').html("Copied!");
                } else {
                    $btn.find('span').html("Error!");
                }
            }
            $btn.transition('pulse');
        },

        render_attributes: async function() {
            const users = await F.atlas.getContacts(this.model.get('members'));
            const recipients = [];
            const pendingMembers = this.model.get('pendingMembers') || [];
            for (const user of users) {
                if (!user || user.id === F.currentUser.id) {
                    continue;
                }
                const errors = [];
                const pending = pendingMembers.indexOf(user.id) !== -1;
                let sent;
                let sending;
                let delivered = 0;
                let deliveredCount = 0;
                if (!this.model.get('incoming') && this.model.get('type') !== 'clientOnly') {
                    const receipts = this.model.receipts.where({addr: user.id});
                    sending = !receipts.length;
                    for (const r of receipts) {
                        if (r.get('type') === 'error') {
                            errors.push(r.attributes);
                        } else if (r.get('type') === 'delivery') {
                            delivered = Math.max(delivered, r.get('timestamp'));
                            deliveredCount++;
                        } else if (r.get('type') === 'sent') {
                            sent = r.get('timestamp');
                        }
                    }
                }
                recipients.push(Object.assign({
                    avatar: await user.getAvatar(),
                    name: user.getName(),
                    tagSlug: user.getTagSlug(),
                    orgAttrs: (await user.getOrg()).attributes,
                    errors,
                    sent,
                    sending,
                    pending,
                    delivered,
                    deliveredCount
                }, user.attributes));
            }
            const typeIcons = {
                content: 'comment',
                poll: 'pie'
            };
            const userAgent = this.model.get('userAgent');
            return Object.assign({
                typeIcon: typeIcons[this.model.get('type')] || 'help circle',
                recipients,
                shortUserAgent: userAgent && userAgent.split(/\s/)[0],
                mobile: !userAgent.match(new RegExp(F.product)),
                expiresAt: Date.now() + this.model.msTilExpire()
            }, this.model.attributes);
        }
    });

    F.MessagesView = F.ListView.extend({

        className: 'f-messages-view ui feed',
        ItemView: F.MessageItemView,

        initialize: function(options) {
            options.reverse = true;
            options.remove = false;
            F.ListView.prototype.initialize.call(this, options);
            this.disableMessageInfo = options.disableMessageInfo;
            this.disableSenderInfo = options.disableSenderInfo;
            this.onScroll = this._onScroll.bind(this);
            this.onTouchStart = this._onTouchStart.bind(this);
            this.onTouchEnd = this._onTouchEnd.bind(this);
            this.on('adding', this.onAdding);
            this.on('added', this.onAdded);
            this.on('reset', this.onReset);
            this._elId = 'message-view-' + this.cid;
            if (self.ResizeObserver) {
                this._resizeObserver = new ResizeObserver(() => this.scrollRestore());
                this._resizeObserver.observe(this.el);
            } else {
                this.$el.attr('id', `message-${this.cid}`);
                $(self).on(`resize #message-${this.cid}`, () => this.scrollRestore());
                if (self.MutationObserver) {
                    this._mutationObserver = new MutationObserver(() => this.scrollRestore());
                }
            }
        },

        setScrollElement: function(scrollEl) {
            F.assert(scrollEl === this.el.parentNode);
            if (this.scrollEl) {
                throw new Error("Unsupported");
            }
            this.scrollEl = scrollEl;
            scrollEl.addEventListener('scroll', this.onScroll, passiveEventOpt);
            scrollEl.addEventListener('touchstart', this.onTouchStart, passiveEventOpt);
            scrollEl.addEventListener('touchend', this.onTouchEnd, passiveEventOpt);
            if (this._resizeObserver) {
                this._resizeObserver.observe(scrollEl);
            } else {
                $(scrollEl).attr('id', `message-${this.cid}-parent`);
                $(self).on(`resize #message-${this.cid}-parent`, () => this.scrollRestore());
                if (this._mutationObserver) {
                    this._mutationObserver.observe(scrollEl.parentNode, {
                        attributes: true,
                        childList: true,
                        subtree: true,
                        characterData: false
                    });
                }
            }
        },

        remove: function() {
            if (this._resizeObserver) {
                this._resizeObserver.disconnect();
            } else if (this._mutationObserver) {
                this._mutationObserver.disconnect();
            }
            return F.ListView.prototype.remove.apply(this, arguments);
        },

        shouldMerge(messageA, messageB) {
            return messageA && messageB &&
                   messageA.get('sender') === messageB.get('sender') &&
                   Math.abs(messageA.get('sent') - messageB.get('sent')) < (3600 * 1000);
        },

        onAdding: function(view) {
            this.scrollSave();
            const index = this.collection.indexOf(view.model);
            if (index > 0) {
                const newer = this.collection.at(index - 1);
                if (this.shouldMerge(newer, view.model)) {
                    view.$el.addClass('merge-with-next');
                    const newerView = this.getItem(newer);
                    if (newerView) {
                        newerView.$el.addClass('merge-with-prev');
                    }
                }
            }
            if (index >= 0) {
                const older = this.collection.at(index + 1);
                if (this.shouldMerge(older, view.model)) {
                    view.$el.addClass('merge-with-prev');
                    const olderView = this.getItem(older);
                    if (olderView) {
                        olderView.$el.addClass('merge-with-next');
                    }
                }
            }
        },

        onReset: function(views) {
            let newer;
            for (const x of views) {
                if (newer && this.shouldMerge(newer.model, x.model)) {
                    x.$el.addClass('merge-with-next');
                    newer.$el.addClass('merge-with-prev');
                }
                newer = x;
            }
        },

        onAdded: async function(view) {
            this.scrollRestore();
            const last = this.indexOf(view.model) === this.getItems().length - 1;
            if (last && view.model.get('incoming') && !this.isHidden() &&
                !(await F.state.get('notificationSoundMuted'))) {
                await F.util.playAudio('audio/new-message.mp3');
            }
        },

        _onScroll: function() {
            if (this.viewportResized() || this.nonInteraction()) {
                this.scrollRestore();
            } else {
                this.scrollSave();
                if (!this._scrollPin && this.scrollEl.scrollTop === 0) {
                    setTimeout(() => {
                        // Prevent scroll from sticking to top for overflow-anchor browsers; 
                        //this.scrollEl.scrollTop = 1;
                        this.trigger('loadmore', this);
                    }, 0);
                }
            }
        },

        _onTouchStart: function() {
            this.touching = true;
        },

        _onTouchEnd: function() {
            this.touching = false;
            this.lastTouch = Date.now();
        },

        nonInteraction: function() {
            /* If the user couldn't be interacting.
             * Eg. They aren't on the page or haven't touched the screen. */
            const recentEnough = Date.now() - 100;
            return (!this.touching || this.lastTouch > recentEnough) && !$(this.scrollEl).is(':hover');
        },

        viewportResized: function() {
            /* Return true if the inner or outer viewport changed size. */
            const prev = this._viewportSizes || [];
            const cur = [this.scrollEl.scrollWidth, this.scrollEl.scrollHeight,
                         this.scrollEl.clientWidth, this.scrollEl.clientHeight];
            const changed = !cur.every((v, i) => prev[i] === v);
            this._viewportSizes = cur;
            return changed;
        },

        scrollSave: function() {
            let pin;
            let pos;
            if (!this.scrollEl) {
                pos = 0;
                pin = true;
            } else {
                // Adjust for rounding and scale/zoom error.
                const slop = 2;
                pos = this.scrollEl.scrollTop + this.scrollEl.clientHeight;
                pin = pos >= this.scrollEl.scrollHeight - slop;
            }
            this._scrollPos = pos;
            this._scrollHeight = this.scrollEl.scrollHeight;
            if (!this._scrollChanging && this.nonInteraction()) {
                // Abort pin alteration as user interaction was not possible.
                this.scrollTail();
            } else if (pin != this._scrollPin) {
                console.info(pin ? 'Pinning' : 'Unpinning', 'message pane');
                this._scrollPin = pin;
            }
            return {
                pin: this._scrollPin,
                pos: this._scrollPos,
                height: this._scrollHeight
            };
        },

        scrollTail: function(force) {
            if (force) {
                this._scrollPin = true;
            }
            if (this._scrollPin) {
                this.scrollEl.scrollTop = this.scrollEl.scrollHeight + 1000;
                this._scrollPos = this.scrollEl.scrollTop + this.scrollEl.clientHeight;
                this._scrollHeight = this.scrollEl.scrollHeight;
            }
            return this._scrollPin;
        },

        scrollRestore: function(context) {
            if (context) {
                this._scrollPin = context.pin;
                this._scrollPos = context.pos;
                this._scrollHeight = context.height;
                this._scrollChanging = false;  // Clear to force update regardless..
            }
            if (!this._scrollChanging && !this.scrollTail() && this._scrollPos) {
                this.scrollEl.scrollTop = (this.scrollEl.scrollHeight - this._scrollHeight) +
                                          (this._scrollPos - this.scrollEl.clientHeight);
            }
        },

        resetCollection: async function() {
            this._scrollPin = true;
            await F.ListView.prototype.resetCollection.apply(this, arguments);
            this.scrollTail(/*force*/ true);
        },

        removeModel: async function(model) {
            /* If the model is expiring it calls remove manually later. */
            if (!model._expiring) {
                return await F.ListView.prototype.removeModel.apply(this, arguments);
            }
        },

        isHidden: function() {
            return document.hidden || !(this.$el && this.$el.is(":visible"));
        },

        unpin: function() {
            this._scrollPin = false;
        },

        scrollIntoView: function(model) {
            const item = this.getItem(model);
            this._scrollPin = false;
            this._scrollChanging = true;
            try {
                item.el.scrollIntoView();
            } finally {
                F.util.animationFrame().then(() => {
                    this.scrollSave();
                    this._scrollChanging = false;
                });
            }
        },

        waitAdded: async function(model) {
            const item = this.getItem(model);
            if (item) {
                return item;
            }
            let onAdded;
            let onReset;
            const itemReady = new Promise(resolve => {
                onAdded = item => {
                    if (item.model.id === model.id) {
                        resolve(item);
                    }
                };
                onReset = () => {
                    const item = this.getItem(model);
                    if (item) {
                        resolve(item);
                    }
                };
            });
            this.on('added', onAdded);
            this.on('reset', onReset);
            try {
                return await itemReady;
            } finally {
                this.off('added', onAdded);
                this.off('reset', onReset);
            }
        }
    });
})();
