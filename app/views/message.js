/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};

    const ErrorView = F.View.extend({
        template: 'article/messages-error.html',

        initialize: function(options) {
            F.View.prototype.initialize.apply(this, arguments);
            this.error = this.model.get('errors')[0];
        },

        special_icons: {
            OutgoingIdentityKeyError: 'spy',
            UnregisteredUserError: 'remove user'
        },

        render_attributes: function() {
            const icon = this.special_icons[this.error.name];
            return _.extend({icon}, this.error);
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$('.link').popup();
            return this;
        },

        events: {
            'click .link': 'onClick'
        },

        onClick: function(ev) {
            const handlers = {
                OutgoingIdentityKeyError: this.resolveConflicts
            };
            const fn = handlers[this.error.name];
            if (fn) {
                fn.call(this);
                ev.stopPropagation();
            } else {
                console.warn("No error click handler for:", this.error);
            }
        },

        resolveConflicts: function() {
            this.model.collection.conversation.resolveConflicts(this.model);
        }
    });

    const NetworkErrorView = F.View.extend({
        template: 'article/messages-network-error.html',

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$('.link').popup();
            return this;
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
        },

        events: {
            'click .f-retry': 'retryMessage',
            'click .summary .link': 'select',
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

        select: function(ev) {
            //this.$el.trigger('select', {message: this.model});
            console.log("XXX select msg make a onhover nag popup thing for this.");
            ev.stopPropagation();
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

        onErrorsChanged: async function() {
            if (this.model.isIncoming()) {
                await this.render();
            } else {
                await this.renderErrors();
            }
        },

        renderErrors: async function() {
            var errors = this.model.get('errors');
            if (_.size(errors) > 0) {
                if (this.model.isIncoming()) {
                    this.$('.content').text(this.model.getDescription()).addClass('error-message');
                }
                const v = new ErrorView({model: this.model, el: this.$('.summary .error')});
                await v.render();
            } else {
                this.$('.summary .error').empty();
            }
            if (this.model.hasNetworkError()) {
                const v = new NetworkErrorView({el: this.$('.summary .network-error')});
                await v.render();
            } else {
                this.$('.summary .network-error').empty();
            }
        },

        renderControl: function() {
            if (this.model.isEndSession() || this.model.isGroupUpdate()) {
                this.$el.addClass('control');
                var content = this.$('.meta');
                content.text(F.emoji.replace_unified(this.model.getDescription()));
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
                html_safe: F.emoji.replace_unified(F.util.htmlSanitize(data.html))
            });
            let plain = data.plain.split(" ");
            for (let i = 0 ; i < plain.length ; i++) {
              if (plain[i].includes("youtube.com")) {
                let videoId = this.getId(plain[i]);
                let iframe = '<iframe width="50%" height="375px" src="//www.youtube.com/embed/' + videoId + '" frameborder="0" allowfullscreen></iframe>';
                data.html_safe = iframe + "<br>" + data.html_safe;
              }
            }
            return data;
        },

        getId: function(url) {
            var regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
            var match = url.match(regExp);

            if (match && match[2].length == 11) {
                return match[2];
            } else {
                return 'error';
            }
        },

        render: async function() {
            this.contact = await this.model.getContact();
            await F.View.prototype.render.call(this);
            this.timeStampView.setElement(this.$('.timestamp'));
            this.timeStampView.update();
            this.renderControl();
            this.renderSent();
            this.renderDelivered();
            await this.renderErrors();
            this.renderExpiring();
            this.loadAttachments();
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

    F.ExpirationTimerUpdateView = F.MessageItemView.extend({
        template: 'article/messages-expire-update.html',

        render_attributes: function() {
            const attrs = F.MessageItemView.prototype.render_attributes.call(this);
            const seconds = this.model.get('expirationTimerUpdate').expireTimer;
            attrs.expire = Whisper.ExpirationTimerOptions.getName(seconds);
            return attrs;
        }
    });

    F.KeyChangeView = F.MessageItemView.extend({
        template: 'article/messages-keychange.html',

        events: {
            'click .content': 'verifyIdentity'
        },

        render_attributes: async function() {
            const attrs = F.MessageItemView.prototype.render_attributes.call(this);
            const convo = await this.model.getModelForKeyChange();
            attrs.actor = {
                title: convo.getTitle(),
                avatar: convo.getAvatar()
            };
            return attrs;
        },

        verifyIdentity: async function() {
            const convo = await this.model.getModelForKeyChange();
            this.$el.trigger('verify-identity', convo);
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
