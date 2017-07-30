/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    const ErrorView = F.View.extend({
        template: 'article/messages-error.html',

        initialize: function(options) {
            F.View.prototype.initialize.apply(this, arguments);
            this.conversation = options.conversation;
            this.errors = this.model.get('errors');
        },

        errorsManifest: {
            OutgoingIdentityKeyError: {
                icon: 'spy',
                actions: [
                    ['Verify New Identity', 'resolveOutgoingConflict']
                ]
            },
            IncomingIdentityKeyError: {
                icon: 'spy',
                actions: [
                    ['Verify New Identity', 'resolveIncomingConflict']
                ]
            },
            UnregisteredUserError: { // XXX the system should auto-remove them.
                icon: 'ban'
            },
            SendMessageNetworkError: {
                icon: 'unlinkify red',
                actions: [
                    ['Retry Send', 'retrySend']
                ]
            },
            MessageError: {
                icon: 'unlinkify red',
                actions: [
                    ['Retry Send', 'retrySend']
                ]
            },
            OutgoingMessageError: {
                icon: 'unlinkify red',
                actions: [
                    ['Retry Send', 'retrySend']
                ]
            }
        },

        render_attributes: function() {
            return this.errors.map((x, idx) => {
                const attrs = _.extend({idx}, x);
                const error = this.errorsManifest[x.name];
                if (!error) {
                    console.warn("Unhandled error type:", x);
                } else {
                    attrs.icon = error.icon;
                    attrs.actions = error.actions;
                }
                return attrs;
            });
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            const _this = this; // Save for onCreate
            this.$('.f-error').popup({
                exclusive: true,
                on: 'click',
                onCreate: function() {
                    const popup = this;
                    popup.on('click', 'button', _this.onPopupAction.bind(_this));
                }
            });
            return this;
        },

        onPopupAction: async function(ev) {
            const fn = this[ev.target.name];
            const error = this.errors[ev.target.dataset.erroridx];
            if (fn) {
                ev.stopPropagation();
                // XXX convert errors here into user feedback ?
                await fn.call(this, error);
            } else {
                console.warn("No error click handler for:", error);
            }
        },

        resolveIncomingConflict: function(error) {
            const convo = this.model.conversations.get(this.model.get('source'));
            convo.resolveConflicts(error);
        },

        resolveOutgoingConflict: function(error) {
            this.model.resolveConflict(error.addr);
        },

        retrySend: function(error) {
            this.model.resend(error.addr);
        }

    });

    const TimerView = F.View.extend({
        className: 'timer',

        initialize: function() {
            if (this.model.isExpiring()) {
                this.render();
                var totalTime = this.model.get('expireTimer') * 1000;
                var remainingTime = this.model.msTilExpire();
                var elapsed = (totalTime - remainingTime) / totalTime;
                this.$el.append('<span class="hourglass"><span class="sand"></span></span>');
                this.$('.sand')
                    .css('animation-duration', remainingTime*0.001 + 's')
                    .css('transform', 'translateY(' + elapsed*100 + '%)');
                this.$el.css('display', 'inline-block');
            }
            return this;
        }
    });

    F.MessageItemView = F.View.extend({
        template: 'article/messages-item.html',

        id: function() {
            return this.model.id;
        },

        initialize: function(options) {
            const listen = (events, cb) => this.listenTo(this.model, events, cb);
            listen('change:html change:plain change:flags change:group_update', this.render);
            listen('change:errors', this.onErrorsChanged);
            if (this.model.isOutgoing()) {
                this.status = this.model.get('delivered') ? 'delivered' :
                              this.model.get('sent') ? 'sent' : undefined;
                listen('change:sent', () => this.setStatus('sent'));
                listen('change:deliveryReceipts', () => this.onDelivery());
                listen('pending', () => this.setStatus('pending'));
            }
            listen('change:expirationStartTimestamp', this.renderExpiring);
            listen('remove', this.onRemove);
            listen('expired', this.onExpired);
            this.timeStampView = new F.ExtendedTimestampView();
        },

        events: {
            'click .f-retry': 'retryMessage',
            'click .f-moreinfo-toggle.link': 'onMoreInfoToggle'
        },

        className: function() {
            return `event ${this.model.get('type')}`;
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

        onMoreInfoToggle: async function(ev) {
            //this.render(); // XXX probably though
            this.$('.shape').shape(ev.target.dataset.transition);
        },

        onDelivery: function() {
            const deliveredAddrs = new Set();
            for (const x of (this.model.get('deliveryReceipts') || [])) {
                deliveredAddrs.add(x.split('.'))[0];
            }
            if (deliveredAddrs.size >= this.model.get('sent').length) {
                this.setStatus('delivered');
            }
        },

        setStatus: function(status) {
            this.status = status;
            this.renderStatus();
        },

        renderStatus: function() {
            const icons = {
                pending: 'notched circle loading grey',
                sent: 'radio grey',
                delivered: 'check circle outline grey',
            };
            const icon = icons[this.status];
            console.assert(icon, `No icon for status: ${this.status}`);
            this.$('.f-status i').attr('class', `icon ${icon}`);
        },

        onErrorsChanged: async function() {
            if (this.model.isIncoming()) {
                await this.render();
            } else {
                await this.renderErrors();
            }
        },

        renderErrors: async function() {
            const errors = this.model.get('errors');
            const $errorbar = this.$('.icon-bar.errors');
            if (errors && errors.length) {
                const v = new ErrorView({
                    model: this.model,
                    el: $errorbar
                });
                await v.render();
            } else {
                $errorbar.empty();
            }
        },

        renderEmbed: function() {
            this.$('.extra.text a[type="unfurlable"]').oembed();
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
                const sender = this.model.getSender();
                senderName = sender.getName();
                avatar = (await sender.getAvatar());
            }
            const attrs = F.View.prototype.render_attributes.call(this);
            const userAgent = this.model.get('userAgent') || '';
            return Object.assign(attrs, {
                senderName,
                mobile: !userAgent.match(new RegExp(F.product)),
                avatar,
                incoming: this.model.isIncoming(),
                meta: this.model.getMeta(),
                safe_html: attrs.safe_html && F.emoji.replace_unified(attrs.safe_html)
            });
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.timeStampView.setElement(this.$('.timestamp'));
            this.timeStampView.update();
            if (this.status && this.model.isOutgoing()) {
                this.renderStatus();
                this.onDelivery();
            }
            this.renderEmbed();
            this.renderPlainEmoji();
            this.renderExpiring();
            this.loadAttachments();
            this.renderErrors(); // async render is fine.
            return this;
        },

        loadAttachments: async function() {
            await Promise.all(this.model.get('attachments').map(attachment => {
                var view = new F.AttachmentView({model: attachment});
                this.listenTo(view, 'update', function() {
                    if (!view.el.parentNode) {
                        this.$('.attachments').append(view.el);
                    }
                });
                this.$('.attachments').append(view.el);
                return view.render();
            }));
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
         * the cursor position used for convo switching.
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
        },

        removeModel: async function(model) {
            /* If the model is expiring it calls remove manually later. */
            if (!model._expiring) {
                return await F.ListView.prototype.removeModel.apply(this, arguments);
            }
        }
    });
})();
