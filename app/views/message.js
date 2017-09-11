// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    const newMessageAudio = new Audio(F.urls.static + '/audio/new-message.ogg');

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
            return this.model.id;
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
                    url: '/@static/images/icon_256.png'
                };
                senderName = 'Forsta';
            } else {
                const sender = await this.model.getSender();
                senderName = sender.getName();
                avatar = await sender.getAvatar();
            }
            const attrs = F.View.prototype.render_attributes.call(this);
            const userAgent = this.model.get('userAgent') || '';
            return Object.assign(attrs, {
                senderName,
                mobile: !userAgent.match(new RegExp(F.product)),
                avatar,
                meta: this.model.getMeta(),
                safe_html: attrs.safe_html && F.emoji.replace_unified(attrs.safe_html),
            });
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
            }
            if (this.model.get('sourceDevice') !== await F.state.get('deviceId')) {
                return undefined;  // We can't know any better.
            }
            return this._hasAllReceipts('sent');
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
            if (!this._detailsView) {
                $toggleIcon.removeClass('expand compress').addClass(loadingIcon);
                const view = new F.MessageDetailsView({
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
                    $toggleIcon.removeClass(`${loadingIcon} expand`).addClass('compress');
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
                    $toggleIcon.removeClass(`${loadingIcon} compress`).addClass('expand');
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
                pending: 'notched circle loading grey',
                sent: 'radio grey',
                delivered: 'check circle outline grey',
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
                        transition: '',
                        maxHeight: '0'
                    });
                    $minIcon.hide();
                    $maxIcon.show();
                });
            } else {
                this.model.save({minimized: false});
                $section.css({
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

        initialize: function() {
            this.thread = F.foundation.getThreads().get(this.model.get('threadId'));
        },

        events: {
            'click .f-purge': 'purgeMessage'
        },

        purgeMessage: async function() {
            await F.util.confirmModal({
                header: "Delete this message?",
                content: "Please confirm you wish to delete the local copy of this message."
            }) && this.model.destroy();
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
                let delivered = 0;
                let deliveredCount = 0;
                const receipts = this.model.receipts.where({addr: user.id});
                for (const r of receipts) {
                    if (r.get('type') === 'error') {
                        console.warn("Message Error Receipt:", r);
                        errors.push(r.attributes);
                    } else if (r.get('type') === 'sent') {
                        sent = r.get('timestamp');
                    } else if (r.get('type') === 'delivery') {
                        delivered = Math.max(delivered, r.get('timestamp'));
                        deliveredCount++;
                    }
                }
                recipients.push(Object.assign({
                    avatar: await user.getAvatar(),
                    name: user.getName(),
                    slug: user.getSlug(),
                    fqslug: await user.getFQSlug(),
                    domain: (await user.getDomain()).attributes,
                    errors,
                    sent,
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
            this.observer = new MutationObserver(this.onMutate.bind(this));
            options.reverse = true;
            options.remove = false;
            return F.ListView.prototype.initialize.call(this, options);
        },

        render: async function() {
            await F.ListView.prototype.render.apply(this, arguments);
            this.observer.observe(this.el.parentNode, {
                attributes: true,
                childList: true,
                subtree: true,
                characterData: false
            });
            $(self).on(`resize #${this.id}`, this.onResize.bind(this));
            return this;
        },

        events: {
            'scroll': 'onScroll',
        },

        onMutate: function() {
            return this.maybeKeepScrollPinned();
        },

        onResize: function() {
            this.maybeKeepScrollPinned();
        },

        /*
         * Debounce scroll monitoring to give resize and mutate a chance
         * first.  We only need this routine to stop tailing for saving
         * the cursor position used for thread switching.
         */
        onScroll: _.debounce(function() {
            this.scrollTick();
            if (!this._scrollPin && this.el.scrollTop === 0) {
                console.info("Loading more data...");
                this.$el.trigger('loadMore');
            }
        }, 25),

        maybeKeepScrollPinned: function() {
            if (this._scrollPin) {
                this.el.scrollTop = this.el.scrollHeight;
            }
            return this._scrollPin;
        },

        scrollTick: function() {
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
            if (pin != this._scrollPin) {
                console.info(pin ? 'Pinning' : 'Unpinning', 'message pane');
                this._scrollPin = pin;
            }
        },

        loadSavedScrollPosition: function() {
            if (!this.maybeKeepScrollPinned() && this._scrollPos) {
                this.el.scrollTop = this._scrollPos;
            }
        },

        resetCollection: async function() {
            this.scrollTick();
            await F.ListView.prototype.resetCollection.apply(this, arguments);
            this.maybeKeepScrollPinned();
        },

        addModel: async function(model) {
            this.scrollTick();
            await F.ListView.prototype.addModel.apply(this, arguments);
            this.maybeKeepScrollPinned();
            if (model.get('incoming')) {
                newMessageAudio.play();
            }
        },

        removeModel: async function(model) {
            /* If the model is expiring it calls remove manually later. */
            if (!model._expiring) {
                return await F.ListView.prototype.removeModel.apply(this, arguments);
            }
        }
    });
})();
