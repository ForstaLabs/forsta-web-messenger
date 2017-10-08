// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    let passiveEventOpt = undefined;
    (function() {
        class detector {
            static get passive() {
                passiveEventOpt = {passive: true};
            }
        }
        addEventListener("test", null, detector);
    })();

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

        id: function() {
            return 'message-item-view-' + this.model.cid;
        },

        className: function() {
            return `event ${this.model.get('type')}`;
        },

        initialize: function(options) {
            const listen = (events, cb) => this.listenTo(this.model, events, cb);
            listen('change:html change:plain change:flags', this.render);
            listen('change:expirationStart', this.renderExpiring);
            listen('remove', this.onRemove);
            listen('expired', this.onExpired);
            this.listenTo(this.model.receipts, 'add', this.onReceipt);
            this.timeStampView = new F.ExtendedTimestampView();
        },

        events: {
            'click .f-details-toggle': 'onDetailsToggle',
            'click .f-status': 'onDetailsToggle',
            'click .f-display-toggle': 'onDisplayToggle'
        },

        render_attributes: async function() {
            let avatar;
            let senderName;
            if (this.model.isClientOnly()) {
                avatar = {
                    color: 'black',
                    url: F.util.versionedURL(F.urls.static + 'images/icon_256.png')
                };
                senderName = 'Forsta';
            } else {
                const sender = await this.model.getSender();
                senderName = sender.getName();
                avatar = await sender.getAvatar();
            }
            const attrs = F.View.prototype.render_attributes.call(this);
            return Object.assign(attrs, {
                senderName,
                mobile: this.getMobile(),
                avatar,
                meta: this.model.getMeta(),
                safe_html: attrs.safe_html && F.emoji.replace_unified(attrs.safe_html),
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
            this.timeStampView.setElement(this.$('.timestamp'));
            this.timeStampView.update();
            this.renderEmbed();
            this.renderPlainEmoji();
            this.renderExpiring();
            await Promise.all([this.renderStatus(), this.loadAttachments()]);
            return this;
        },

        onReceipt: async function(receipt) {
            await this.renderStatus();
        },

        renderStatus: async function() {
            if (this.hasErrors()) {
                await this.setStatus('error', /*prio*/ 100, 'A problem was detected');
                return;
            }
            if (this.model.get('incoming') || this.model.get('type') === 'clientOnly') {
                return;
            }
            if (await this.isDelivered()) {
                await this.setStatus('delivered', /*prio*/ 50, 'Delivered');
            } else if (await this.isSent()) {
                this.setStatus('sent', /*prio*/ 10, 'Sent (awaiting delivery)');
            } else {
                this.setStatus('pending', /*prio*/ 1, 'Sending');
            }
        },

        hasErrors: function() {
            return this.model.receipts.any({type: 'error'});
        },

        isDelivered: async function() {
            /* Returns true if at least one device for each of the recipients has sent a
             * delivery reciept. */
            if (this.model.get('incoming') || this.model.get('type') === 'clientOnly') {
                return false;
            }
            return this._hasAllReceipts('delivery');
        },

        isSent: async function() {
            /* Returns true when all recipeints in this thread have been sent to. */
            if (this.model.get('incoming') || this.model.get('type') === 'clientOnly') {
                return false;
            } else if (this.model.get('senderDevice') !== F.currentDevice) {
                return true;  // We can't know any better.
            } else {
                return this._hasAllReceipts('sent');
            }
        },

        _hasAllReceipts: function(type) {
            const members = new F.util.ESet(this.model.get('members'));
            members.delete(F.currentUser.id);
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
                        transition: 'max-height 600ms ease-in, max-width 600ms ease-in',
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
                const duration = 400;
                requestAnimationFrame(() => {
                    $toggleIcon.removeClass(`${loadingIcon} ${contractIcon}`).addClass(expandIcon);
                    view.$el.css({
                        transition: `max-height ${duration}ms ease-out, max-width ${duration}ms ease-out`,
                        maxHeight: '0',
                        maxWidth: view._minWidth
                    });
                    /* Wait until just after CSS transition finishes to remove the view */
                    F.util.sleep((duration + 50) / 1000).then(() => view.remove());
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
                pending: 'notched circle loading',
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
                this.$('.extra.text a[type="unfurlable"]').oembed();
            } catch(e) {
                console.error("OEmbed Error:", e);
            }
        },

        renderPlainEmoji: function() {
            /* We don't want to render plain as html so this safely replaces unicode emojis
             * with html after handlebars has scrubbed the input. */
            const plain = this.$('.extra.text.plain');
            if (plain.length) {
                plain.html(F.emoji.replace_unified(this.model.get('plain')));
            }
        },

        renderExpiring: function() {
            new TimerView({
                model: this.model,
                el: this.$('.icon-bar .timer')
            });
        },

        loadAttachments: async function() {
            await Promise.all(this.model.get('attachments').map(attachment => {
                const view = new F.AttachmentView({model: attachment});
                this.listenTo(view, 'update', function() {
                    if (!view.el.parentNode) {
                        this.$('.attachments').append(view.el);
                    }
                });
                this.$('.attachments').append(view.el);
                return view.render();
            }));
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
        }
    });

    F.MessageDetailsView = F.View.extend({
        template: 'views/message-details.html',
        class: 'f-message-details',

        initialize: function(options) {
            this.thread = F.foundation.getThreads().get(this.model.get('threadId'));
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
            const users = await F.ccsm.userDirectoryLookup(this.model.get('members'));
            const recipients = [];
            for (const user of users) {
                if (user.id === F.currentUser.id) {
                    continue;
                }
                const errors = [];
                let sent;
                let pending;
                let delivered = 0;
                let deliveredCount = 0;
                if (!this.model.get('incoming') && this.model.get('type') !== 'clientOnly') {
                    const receipts = this.model.receipts.where({addr: user.id});
                    pending = !receipts.length;
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
                    slug: user.getSlug(),
                    fqslug: await user.getFQSlug(),
                    orgAttrs: (await user.getOrg()).attributes,
                    errors,
                    sent,
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

    F.MessageView = F.ListView.extend({

        ItemView: F.MessageItemView,

        initialize: function(options) {
            options.reverse = true;
            options.remove = false;
            F.ListView.prototype.initialize.call(this, options);
            this.on('added', this.onAdded);
            this._elId = 'message-view-' + this.collection.thread.cid;
            $(self).on('resize #' + this._elId, this.onResize.bind(this));
            this._onScroll = this.onScroll.bind(this);
            this._onTransEnd = this.scrollTail.bind(this, undefined);
            this._onTouchStart = this.onTouchStart.bind(this);
            this._onTouchEnd = this.onTouchEnd.bind(this);
        },

        render: async function() {
            if (this._rendered) {
                this._mobserver.disconnect();
                this.el.removeEventListener('scroll', this._onScroll);
                this.el.parentNode.removeEventListener('transitionend', this._onTransEnd);
                this.el.removeEventListener('touchstart', this._onTouchStart);
                this.el.removeEventListener('touchend', this._onTouchEnd);
            }
            await F.ListView.prototype.render.call(this);
            this.$el.attr('id', this._elId);
            this._mobserver = new MutationObserver(this.onMutate.bind(this));
            this._mobserver.observe(this.el.parentNode, {
                attributes: true,
                childList: true,
                subtree: true,
                characterData: false
            });
            this.el.addEventListener('scroll', this._onScroll, passiveEventOpt);
            this.el.parentNode.addEventListener('transitionend', this._onTransEnd);
            this.el.addEventListener('touchstart', this._onTouchStart, passiveEventOpt);
            this.el.addEventListener('touchend', this._onTouchEnd, passiveEventOpt);
            return this;
        },

        onAdded: function(view) {
            if (view.model.get('incoming') && !this.isHidden() &&
                this.$el.children().last().is(view.$el)) {
                F.util.playAudio('audio/new-message.wav');
            }
        },

        onMutate: function() {
            this.scrollTail();
        },

        onResize: function() {
            this.scrollTail();
        },

        onScroll: _.debounce(function() {
            requestAnimationFrame(function() {
                if (this.viewportResized() || this.nonInteraction()) {
                    this.scrollTail();
                } else {
                    this.scrollSave();
                    if (!this._scrollPin && this.el.scrollTop === 0) {
                        console.info("Try loading more messages...");
                        setTimeout(() => this.$el.trigger('loadMore'), 0);
                    }
                }
            }.bind(this));
        }, 25),

        onTouchStart: function() {
            this.touching = true;
        },

        onTouchEnd: function() {
            this.touching = false;
            this.lastTouch = Date.now();
        },

        nonInteraction: function() {
            /* If the user couldn't be interacting.
             * Eg. They aren't on the page or haven't touched the screen. */
            const recentEnough = Date.now() - 100;
            return (!this.touching || this.lastTouch > recentEnough) && !this.$el.is(':hover');
        },

        viewportResized: function() {
            /* Return true if the inner or outer viewport changed size. */
            const prev = this._viewportSizes || [];
            const cur = [this.el.scrollWidth, this.el.scrollHeight,
                         this.el.clientWidth, this.el.clientHeight];
            const changed = !cur.every((v, i) => prev[i] === v);
            this._viewportSizes = cur;
            return changed;
        },

        scrollSave: function() {
            let pin;
            let pos;
            if (!this.el) {
                pos = 0;
                pin = true;
            } else {
                // Adjust for rounding and scale/zoom error.
                const slop = 2;
                pos = this.el.scrollTop + this.el.clientHeight;
                pin = pos >= this.el.scrollHeight - slop;
            }
            this._scrollPos = pos;
            this._scrollHeight = this.el.scrollHeight;
            if (this.nonInteraction()) {
                // Abort pin alteration as user interaction was not possible.
                this.scrollTail();
            } else if (pin != this._scrollPin) {
                console.info(pin ? 'Pinning' : 'Unpinning', 'message pane');
                this._scrollPin = pin;
            }
        },

        scrollTail: function(force) {
            if (force) {
                this._scrollPin = true;
            }
            if (this._scrollPin) {
                this.el.scrollTop = this.el.scrollHeight + 10;
                this._scrollPos = this.el.scrollTop + this.el.clientHeight;
                this._scrollHeight = this.el.scrollHeight;
            }
            return this._scrollPin;
        },

        scrollRestore: function(fromBottom) {
            if (!this.scrollTail() && this._scrollPos) {
                if (fromBottom) {
                    this.el.scrollTop = (this.el.scrollHeight - this._scrollHeight) +
                                        (this._scrollPos - this.el.clientHeight);
                } else {
                    this.el.scrollTop = this._scrollPos - this.el.clientHeight;
                }
            }
        },

        resetCollection: async function() {
            this._scrollPin = true;
            await F.ListView.prototype.resetCollection.apply(this, arguments);
            this.scrollTail();
        },

        addModel: async function(model) {
            this.scrollSave();
            await F.ListView.prototype.addModel.apply(this, arguments);
            const tail = model.collection.indexOf(model) === 0;
            if (tail) {
                this.scrollTail();
            } else {
                this.scrollRestore(/*fromBottom*/ true);
            }
        },

        removeModel: async function(model) {
            /* If the model is expiring it calls remove manually later. */
            if (!model._expiring) {
                return await F.ListView.prototype.removeModel.apply(this, arguments);
            }
        },

        isHidden: function() {
            return document.hidden || !(this.$el && this.$el.is(":visible"));
        }
    });
})();
