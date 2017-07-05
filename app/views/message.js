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
                icon: 'remove user'
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
                    console.warn("Unhandled error type:", x.name);
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
                const maybepromise = fn.call(this, error);
                if (maybepromise instanceof Promise) {
                    // XXX convert errors here into user feedback ?
                    await maybepromise;
                }
            } else {
                console.warn("No error click handler for:", this.error);
            }
        },

        resolveIncomingConflict: function(error) {
            const convo = this.model.conversations.get(this.model.get('source'));
            convo.resolveConflicts(error);
        },

        resolveOutgoingConflict: function(error) {
            // XXX groups?
            this.model.resolveConflict(this.model.get('destination'));
        },

        retrySend: function(error) {
            this.model.resend(error.number);
        }

    });

    const TimerView = Whisper.View.extend({
        templateName: 'hourglass',
        className: 'timer',

        initialize: function() {
            if (this.model.isExpiring()) {
                this.render();
                var totalTime = this.model.get('expireTimer') * 1000;
                var remainingTime = this.model.msTilExpire();
                var elapsed = (totalTime - remainingTime) / totalTime;
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
            listen('change:html change:text change:flags change:group_update', this.render);
            listen('change:errors', this.onErrorsChanged);
            if (this.model.isOutgoing()) {
                this.status = this.model.get('delivered') ? 'delivered' :
                              this.model.get('sent') ? 'sent' : undefined;
                listen('change:sent', () => this.setStatus('sent'));
                listen('change:delivered', () => this.setStatus('delivered'));
                listen('pending', () => this.setStatus('pending'));
                listen('done', () => this.setStatus('done'));
            }
            listen('change:expirationStartTimestamp', this.renderExpiring);
            listen('destroy', this.onDestroy);
            listen('expired', this.onExpired);
            this.timeStampView = new Whisper.ExtendedTimestampView();
        },

        events: {
            'click .f-retry': 'retryMessage',
            'click .f-moreinfo-toggle.link': 'onMoreInfoToggle'
        },

        className: function() {
            return `event ${this.model.get('type')}`;
        },

        onExpired: function() {
            this._expiring = true; // Prevent removal in onDestroy.
            /* NOTE: Must use force-repaint for consistent rendering and timing. */
            this.$el
                .transition('force repaint')
                .transition('shake')
                .transition('fade out', this.remove.bind(this));
        },

        onDestroy: function() {
            if (this._expiring) {
                return;
            }
            this.remove();
        },

        onMoreInfoToggle: function(ev) {
            this.$('.shape').shape(ev.target.dataset.transition);
        },

        setStatus: function(status) {
            this.status = status;
            this.renderStatus();
        },

        renderStatus: function() {
            const icons = {
                pending: 'notched circle loading grey',
                sent: 'radio grey',
                done: 'radio',
                delivered: 'check circle outline grey',
            };
            const icon = icons[this.status];
            console.assert(icon, `No icon for status: ${this.status}`);
            this.$('.f-status i').attr('class', `icon ${icon}`);
        },

        renderSent: function() {
            if (this.model.isOutgoing()) {
                this.$('.f-sent').show();
                //this.$el.toggleClass('sent', !!this.model.get('sent'));
            }
        },

        renderDelivered: function() {
            if (this.model.get('delivered')) {
                this.$('.f-sent').show();
                this.$el.addClass('delivered');
            }
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
            this.$('.extra.text a').oembed();
        },

        renderExpiring: function() {
            new TimerView({
                model: this.model,
                el: this.$('.icon-bar.timer')
            });
        },

        render_attributes: function() {
            const model_attrs = F.View.prototype.render_attributes.call(this);
            let html_safe;
            if (model_attrs.html) {
                const clean = F.util.htmlSanitize(model_attrs.html);
                html_safe = F.emoji.replace_unified(clean);
            }
            return _.extend({
                sender: this.contact.getTitle() || '',
                avatar: this.contact.getAvatar(),
                incoming: this.model.isIncoming(),
                meta: this.model.getMeta(),
                html_safe
            }, model_attrs);
        },

        render: async function() {
            this.contact = await this.model.getContact();
            await F.View.prototype.render.call(this);
            this.timeStampView.setElement(this.$('.timestamp'));
            this.timeStampView.update();
            if (this.status && this.model.isOutgoing()) {
                this.renderStatus();
            }
            this.renderEmbed();
            this.renderExpiring();
            this.loadAttachments();
            this.renderErrors(); // async render is fine.
            return this;
        },

        loadAttachments: function() {
            this.model.get('attachments').forEach(function(attachment) {
                var view = new F.AttachmentView({model: attachment});
                this.listenTo(view, 'update', function() {
                    if (!view.el.parentNode) {
                        this.$('.attachments').append(view.el);
                    }
                });
                view.render();
            }.bind(this));
        }
    });

    F.MessageView = F.ListView.extend({

        ItemView: F.MessageItemView,

        initialize: function(options) {
            this.observer = new MutationObserver(this.onMutate.bind(this));
            return F.ListView.prototype.initialize.apply(this, arguments);
        },

        render: function() {
            const res = F.ListView.prototype.render.apply(this, arguments);
            this.observer.observe(this.el.parentNode, {
                attributes: true,
                childList: true,
                subtree: true,
                characterData: false
            });
            $(self).on(`resize #${this.id}`, this.onResize.bind(this));
            return res;
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

        addOne: async function(model) {
            const view = new this.ItemView({model: model});
            const renderDone = view.render();
            const index = this.collection.indexOf(model);
            view.$el.attr('data-index', index);
            this.scrollTick();
            let added;
            for (const x of this.$el.children()) {
                if (Number(x.dataset.index) > index) {
                    await renderDone;
                    view.$el.insertBefore(x);
                    added = true;
                    break;
                }
            }
            if (!added) {
                await renderDone;
                this.$el.append(view.$el);
            }
            this.maybeKeepScrollPinned();
            this.$holder.trigger('add');
        },
    });

    var ContactView = Whisper.View.extend({
        className: 'contact-detail',
        templateName: 'contact-detail',

        initialize: function(options) {
            this.conflict = options.conflict;
            this.errors = _.reject(options.errors, function(e) {
                return (e.name === 'IncomingIdentityKeyError' ||
                        e.name === 'OutgoingIdentityKeyError' ||
                        e.name === 'OutgoingMessageError' ||
                        e.name === 'SendMessageNetworkError');
            });

        },

        render_attributes: function() {
            return {
                name     : this.model.getTitle(),
                avatar   : this.model.getAvatar(),
                errors   : this.errors
            };
        }
    });

    F.MessageDetailView = Whisper.View.extend({
        className: 'message-detail panel',
        templateName: 'message-detail',

        initialize: function(options) {
            this.view = new F.MessageView({model: this.model});
            this.view.render();
            this.conversation = options.conversation;

            this.listenTo(this.model, 'change', this.render);
        },

        contacts: function() {
            if (this.model.isIncoming()) {
                var number = this.model.get('source');
                return [this.conversation.contactCollection.get(number)];
            } else {
                return this.conversation.contactCollection.models;
            }
        },

        renderContact: function(contact) {
            var view = new ContactView({
                model: contact,
                errors: this.errors[contact.id]
            }).render();
            this.$('.contacts').append(view.el);

            var conflict = this.model.getKeyConflict(contact.id);
            if (conflict) {
                this.renderConflict(contact, conflict);
            }
        },

        renderConflict: function(contact, conflict) {
            var view = new Whisper.KeyConflictDialogueView({
                model: conflict,
                contact: contact,
                conversation: this.conversation
            });
            this.$('.conflicts').append(view.el);
        },

        render: function() {
            this.errors = _.groupBy(this.model.get('errors'), 'number');
            var unknownErrors = this.errors['undefined'];
            if (unknownErrors) {
                unknownErrors = unknownErrors.filter(function(e) {
                    return (e.name !== 'MessageError');
                });
            }
            this.$el.html(Mustache.render(_.result(this, 'template', ''), {
                sent_at     : moment(this.model.get('sent_at')).toString(),
                received_at : this.model.isIncoming() ? moment(this.model.get('received_at')).toString() : null,
                tofrom      : this.model.isIncoming() ? 'From' : 'To',
                errors      : unknownErrors,
                title       : 'Message Detail',
                sent        : 'Sent',
                received    : 'Received',
                errorLabel  : 'Error',
                hasConflict : this.model.hasKeyConflicts()
            }));
            this.view.$el.prependTo(this.$('.message-container'));

            // XXX this is the super jank...
            if (this.model.isOutgoing()) {
                this.conversation.contactCollection.reject(function(c) {
                    throw new Error("getNumber not supported");
                    //return c.id === textsecure.storage.user.getNumber();
                }).forEach(this.renderContact.bind(this));
            } else {
                this.renderContact(
                    this.conversation.contactCollection.get(this.model.get('source'))
                );
            }
        }
    });
})();
