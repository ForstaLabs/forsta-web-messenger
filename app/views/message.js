/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';
    window.Whisper = window.Whisper || {};
    window.F = window.F || {};

    var URL_REGEX = /(^|[\s\n]|<br\/?>)((?:https?|ftp):\/\/[\-A-Z0-9\u00A0-\uD7FF\uE000-\uFDCF\uFDF0-\uFFFD+\u0026\u2019@#\/%?=()~_|!:,.;]*[\-A-Z0-9+\u0026@#\/%=~()_|])/gi;

    var ErrorIconView = Whisper.View.extend({
        templateName: 'error-icon',
        className: 'error-icon-container',
        initialize: function() {
            if (this.model.name === 'UnregisteredUserError') {
                this.$el.addClass('unregistered-user-error');
            }
        }
    });

    var NetworkErrorView = Whisper.View.extend({
        tagName: 'span',
        className: 'hasRetry',
        templateName: 'hasRetry',
        render_attributes: {
            messageNotSent: i18n('messageNotSent'),
            resend: i18n('resend')
        }
    });

    var TimerView = Whisper.View.extend({
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
        templateUrl: 'templates/article/messages-item.html',

        id: function() {
            return this.model.id;
        },

        initialize: function() {
            this.listenTo(this.model, 'change:errors', this.onErrorsChanged);
            this.listenTo(this.model, 'change:html', this.render);
            this.listenTo(this.model, 'change:text', this.render);
            this.listenTo(this.model, 'change:delivered', this.renderDelivered);
            this.listenTo(this.model, 'change:expirationStartTimestamp', this.renderExpiring);
            this.listenTo(this.model, 'change', this.renderSent);
            this.listenTo(this.model, 'change:flags change:group_update', this.renderControl);
            this.listenTo(this.model, 'destroy', this.onDestroy);
            this.listenTo(this.model, 'expired', this.onExpired);
            this.listenTo(this.model, 'pending', this.renderPending);
            this.listenTo(this.model, 'done', this.renderDone);
            this.timeStampView = new Whisper.ExtendedTimestampView();
            this.contact = this.model.getContact();
            this.listenTo(this.contact, 'change:color', this.updateColor);
        },

        events: {
            'click .retry': 'retryMessage',
            'click .error-icon': 'select',
            'click .timestamp': 'select',
            'click .status': 'select',
            'click .error-message': 'select'
        },

        retryMessage: function() {
            var retrys = _.filter(this.model.get('errors'), function(e) {
                return (e.name === 'MessageError' ||
                        e.name === 'OutgoingMessageError' ||
                        e.name === 'SendMessageNetworkError');
            });
            _.map(retrys, 'number').forEach(function(number) {
                this.model.resend(number);
            }.bind(this));
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

        select: function(e) {
            this.$el.trigger('select', {message: this.model});
            console.log("xXX select msg make a onhover nag popup thing for this.");
            e.stopPropagation();
        },

        className: function() {
            return `event ${this.model.get('type')}`;
        },

        renderPending: function() {
            this.$el.addClass('pending');
        },

        renderDone: function() {
            this.$el.removeClass('pending');
        },

        renderSent: function() {
            if (this.model.isOutgoing()) {
                this.$el.toggleClass('sent', !!this.model.get('sent'));
            }
        },

        renderDelivered: function() {
            if (this.model.get('delivered')) {
                this.$el.addClass('delivered');
            }
        },

        onErrorsChanged: function() {
            if (this.model.isIncoming()) {
                this.render();
            } else {
                this.renderErrors();
            }
        },

        renderErrors: function() {
            var errors = this.model.get('errors');
            if (_.size(errors) > 0) {
                if (this.model.isIncoming()) {
                    this.$('.content').text(this.model.getDescription()).addClass('error-message');
                }
                var view = new ErrorIconView({ model: errors[0] });
                view.render().$el.appendTo(this.$('.bubble'));
            } else {
                this.$('.error-icon-container').remove();
            }
            if (this.model.hasNetworkError()) {
                this.$('.meta').prepend(new NetworkErrorView().render().el);
            } else {
                this.$('.meta .hasRetry').remove();
            }
        },

        renderControl: function() {
            if (this.model.isEndSession() || this.model.isGroupUpdate()) {
                this.$el.addClass('control');
                var content = this.$('.meta');
                content.text(this.model.getDescription());
                emoji_util.parse(content);
            } else {
                this.$el.removeClass('control');
            }
        },

        renderExpiring: function() {
            new TimerView({ model: this.model, el: this.$('.timer') });
        },

        render_attributes: function() {
            const attrs = F.View.prototype.render_attributes.call(this);
            const data = _.extend({}, attrs);
            _.extend(data, {
                sender: this.contact.getTitle() || '',
                avatar: this.contact.getAvatar(),
                html_safe: F.util.htmlSanitize(data.html)
            });
            return data;
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.timeStampView.setElement(this.$('.timestamp'));
            this.timeStampView.update();
            this.renderControl();
            const body = this.$('.extra.text');
            emoji_util.parse(body);
            /*if (body.length > 0) {
                var escaped = body.html();
                body.html(escaped.replace(/\n/g, '<br/>').replace(URL_REGEX, "$1<a href='$2' target='_blank'>$2</a>")); // XXX make more better
            }*/
            this.renderSent();
            this.renderDelivered();
            this.renderErrors();
            this.renderExpiring();
            this.loadAttachments();
            return this;
        },

        updateColor: function(model, color) {
            throw new Error("XXX Not implemented");
            var bubble = this.$('.bubble');
            bubble.removeClass(Whisper.Conversation.COLORS);
            if (color) {
                bubble.addClass(color);
            }
            var avatarView = new (Whisper.View.extend({
                templateName: 'avatar',
                render_attributes: { avatar: model.getAvatar() }
            }))();
            this.$('.avatar').replaceWith(avatarView.render().$('.avatar'));
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

    F.ExpirationTimerUpdateView = F.MessageItemView.extend({
        templateUrl: 'templates/article/messages-expire-update.html',

        render_attributes: function() {
            const attrs = F.MessageItemView.prototype.render_attributes.call(this);
            const seconds = this.model.get('expirationTimerUpdate').expireTimer;
            attrs.expire = Whisper.ExpirationTimerOptions.getName(seconds);
            return attrs;
        }
    });

    F.KeyChangeView = F.MessageItemView.extend({
        templateUrl: 'templates/article/messages-keychange.html',

        events: {
            'click .content': 'verifyIdentity'
        },

        render_attributes: function() {
            const attrs = F.MessageItemView.prototype.render_attributes.call(this);
            const convo = this.model.getModelForKeyChange();
            attrs.actor = {
                title: convo.getTitle(),
                avatar: convo.getAvatar()
            };
            return attrs;
        },

        verifyIdentity: function() {
            this.$el.trigger('verify-identity', this.model.getModelForKeyChange());
        }
    });

    F.MessageView = F.ListView.extend({

        initialize: function() {
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
            $(window).on(`resize #${this.id}`, this.onResize.bind(this));
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
            if (!this._scrollPin && this._scrollPos === 0) {
                console.info("Loading more data...");
                this.$el.trigger('loadMore');
            }
        }, 100),

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
            let View;
            if (model.isExpirationTimerUpdate()) {
                View = F.ExpirationTimerUpdateView;
            } else if (model.get('type') === 'keychange') {
                View = F.KeyChangeView;
            } else {
                View = F.MessageItemView;
            }
            const view = new View({model});
            await view.render();
            const index = this.collection.indexOf(model);
            view.$el.attr('data-index', index);
            this.scrollTick();
            for (const x of this.$el.children()) {
                if (Number(x.dataset.index) > index) {
                    view.$el.insertBefore(x);
                    this.maybeKeepScrollPinned();
                    return;
                }
            }
            this.$el.append(view.$el);
            this.maybeKeepScrollPinned();
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
            this.view = new Whisper.MessageView({model: this.model});
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
                tofrom      : this.model.isIncoming() ? i18n('from') : i18n('to'),
                errors      : unknownErrors,
                title       : i18n('messageDetail'),
                sent        : i18n('sent'),
                received    : i18n('received'),
                errorLabel  : i18n('error'),
                hasConflict : this.model.hasKeyConflicts()
            }));
            this.view.$el.prependTo(this.$('.message-container'));

            if (this.model.isOutgoing()) {
                this.conversation.contactCollection.reject(function(c) {
                    return c.id === textsecure.storage.user.getNumber();
                }).forEach(this.renderContact.bind(this));
            } else {
                this.renderContact(
                    this.conversation.contactCollection.get(this.model.get('source'))
                );
            }
        }
    });
})();
