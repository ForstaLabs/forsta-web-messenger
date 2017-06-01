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
        templateName: 'f-article-messages-item',

        id: function() {
            return this.model.id;
        },

        initialize: function() {
            this.listenTo(this.model, 'change:errors', this.onErrorsChanged);
            this.listenTo(this.model, 'change:body', this.render);
            this.listenTo(this.model, 'change:delivered', this.renderDelivered);
            this.listenTo(this.model, 'change:expirationStartTimestamp', this.renderExpiring);
            this.listenTo(this.model, 'change', this.renderSent);
            this.listenTo(this.model, 'change:flags change:group_update', this.renderControl);
            this.listenTo(this.model, 'destroy', this.onDestroy);
            this.listenTo(this.model, 'expired', this.onExpired);
            this.listenTo(this.model, 'pending', this.renderPending);
            this.listenTo(this.model, 'done', this.renderDone);
            this.timeStampView = new Whisper.ExtendedTimestampView();
            this.contact = this.model.isIncoming() ? this.model.getContact() : null;
            if (this.contact) {
                this.listenTo(this.contact, 'change:color', this.updateColor);
            }
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
            this.$el.addClass('expired');
            this.$el.find('.bubble').one('webkitAnimationEnd animationend', function(e) {
                if (e.target === this.$('.bubble')[0]) {
                  this.remove();
                }
            }.bind(this));
        },

        onDestroy: function() {
            if (this.$el.hasClass('expired')) {
              return;
            }
            this.remove();
        },

        select: function(e) {
            this.$el.trigger('select', {message: this.model});
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
            if (this.model.get('delivered')) { this.$el.addClass('delivered'); }
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
                var content = this.$('.content');
                content.text(this.model.getDescription());
                emoji_util.parse(content);
            } else {
                this.$el.removeClass('control');
            }
        },

        renderExpiring: function() {
            new TimerView({ model: this.model, el: this.$('.timer') });
        },

        render: function() {
            var contact = this.model.isIncoming() ? this.model.getContact() : null;
            const attachments = [];
            for (const x of this.model.get('attachments')) {
                const blob = new Blob([x.data], {type: x.contentType});
                attachments.push({
                    url: URL.createObjectURL(blob),
                    content_type: x.contentType
                });
            }
            const tpldata = {
                message: this.model.get('body'),
                timestamp: this.model.get('sent_at'),
                attachments,
                sender: (contact && contact.getTitle()) || '',
                avatar: (contact && contact.getAvatar())
            };
            _.extend(tpldata, _.result(this, 'render_attributes'));
            this.$el.html(this.template(tpldata));
            this.timeStampView.setElement(this.$('.timestamp'));
            this.timeStampView.update();
            this.renderControl();
            const body = this.$('.extra.text');
            emoji_util.parse(body);
            if (body.length > 0) {
                var escaped = body.html();
                body.html(escaped.replace(/\n/g, '<br/>').replace(URL_REGEX, "$1<a href='$2' target='_blank'>$2</a>")); // XXX make more better
            }
            this.renderSent();
            this.renderDelivered();
            this.renderErrors();
            this.renderExpiring();
            this.loadAttachments();
            return this;
        },

        updateColor: function(model, color) {
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
                var view = new Whisper.AttachmentView({ model: attachment });
                this.listenTo(view, 'update', function() {
                    if (!view.el.parentNode) {
                        this.trigger('beforeChangeHeight');
                        this.$('.attachments').append(view.el);
                        this.trigger('afterChangeHeight');
                    }
                });
                view.render();
            }.bind(this));
        }
    });

    F.ExpirationTimerUpdateView = F.MessageItemView.extend({
        templateName: 'f-article-messages-expire-update',
        className: 'event',

        id: function() {
            return this.model.id;
        },

        initialize: function() {
            F.MessageItemView.prototype.initialize.apply(this, arguments);
            this.conversation = this.model.getExpirationTimerUpdateSource();
        },

        render_attributes: function() {
            const seconds = this.model.get('expirationTimerUpdate').expireTimer;
            return {
                expire: Whisper.ExpirationTimerOptions.getName(seconds)
            };
        }
    });

    F.KeyChangeView = F.MessageItemView.extend({
        templateName: 'f-article-messages-keychange',
        className: 'event',

        initialize: function() {
            F.MessageItemView.prototype.initialize.apply(this, arguments);
            this.conversation = this.model.getModelForKeyChange();
        },

        events: {
            'click .content': 'verifyIdentity'
        },

        render_attributes: function() {
            return {
                conversation: this.conversation.getTitle()
            };
        },

        verifyIdentity: function() {
            this.$el.trigger('verify-identity', this.conversation);
        }
    });

    F.MessageView = F.ListView.extend({
        className: 'ui feed messages',
        itemView: F.MessageItemView,

        events: {
            'scroll': 'onScroll',
            'reset-scroll': 'resetScrollPosition'
        },

        onScroll: function() {
            this.measureScrollPosition();
            if (this.$el.scrollTop() === this.el.scrollHeight) {
                console.info("XXX worked?");
                this.$el.trigger('loadMore');
            }
        },

        measureScrollPosition: function() {
            if (this.el.scrollHeight === 0) { // hidden
                return;
            }
            this.scrollPosition = this.$el.scrollTop() + this.$el.outerHeight();
            this.scrollHeight = this.el.scrollHeight;
            this.shouldStickToLatest = this.scrollPosition === this.scrollHeight;
            if (this.shouldStickToLatest) {
                this.bottomOffset = 0;
            } else {
                this.bottomOffset = this.scrollHeight - this.$el.scrollTop();
            }
        },

        resetScrollPosition: function() {
            var scrollPosition = this.scrollPosition;
            if (this.scrollHeight !== this.el.scrollHeight) {
               scrollPosition = this.el.scrollHeight * this.scrollPosition / this.scrollHeight;
            }
            this.$el.scrollTop(scrollPosition - this.$el.outerHeight());
        },

        scrollToLatestIfNeeded: function() {
            this.$el.scrollTop(this.el.scrollHeight - this.bottomOffset);
        },

        addOne: function(model) {
            let View;
            if (model.isExpirationTimerUpdate()) {
                View = F.ExpirationTimerUpdateView;
            } else if (model.get('type') === 'keychange') {
                View = F.KeyChangeView;
            } else {
                View = this.itemView;
            }
            const view = new View({model}).render();
            this.listenTo(view, 'beforeChangeHeight', this.measureScrollPosition);
            this.listenTo(view, 'afterChangeHeight', this.scrollToLatestIfNeeded);
            const index = this.collection.indexOf(model);
            if (index === this.collection.length - 1) {
                // add to the top.
                console.log("add msg to top");
                this.$el.prepend(view.el);
                this.$el.scrollTop(this.el.scrollHeight); // TODO: Avoid scrolling if user has manually scrolled up?
                this.measureScrollPosition();
            } else if (index === 0) {
                // add to bottom
                console.log("add msg to bottom");
                this.measureScrollPosition();
                this.$el.append(view.el);
                this.scrollToLatestIfNeeded();
            } else {
                // insert
                this.measureScrollPosition();

                console.log("add msg to middle");
                var next = this.$('#' + this.collection.at(index - 1).id);
                var prev = this.$('#' + this.collection.at(index + 1).id);
                if (next.length > 0) {
                    view.$el.insertBefore(next);
                } else if (prev.length > 0) {
                    view.$el.insertAfter(prev);
                } else {
                    // scan for the right spot
                    var elements = this.$el.children();
                    if (elements.length > 0) {
                        for (var i = 0; i < elements.length; ++i) {
                            var m = this.collection.get(elements[i].id);
                            var m_index = this.collection.indexOf(m);
                            if (m_index > index) {
                                view.$el.insertBefore(elements[i]);
                                break;
                            }
                        }
                    } else {
                        this.$el.append(view.el);
                    }
                }
                this.scrollToLatestIfNeeded();
            }
        },
    });
})();
