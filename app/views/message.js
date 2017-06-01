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
            this.$el.addClass('expired');
            this.$el.transition('scale', () => this.remove());
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

        render: function() {
            const attachments = [];
            for (const x of this.model.get('attachments')) {
                const blob = new Blob([x.data], {type: x.contentType});
                attachments.push({
                    url: URL.createObjectURL(blob),
                    content_type: x.contentType
                });
            }
            const data = _.result(this, 'render_attributes');
            _.extend(data, {
                attachments,
                sender: this.contact.getTitle() || '',
                avatar: this.contact.getAvatar()
            });
            this.$el.html(this.template(data));
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
            //this.loadAttachments();
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

        render_attributes: function() {
            const attrs = F.MessageItemView.prototype.render_attributes.call(this);
            const seconds = this.model.get('expirationTimerUpdate').expireTimer;
            attrs.expire = Whisper.ExpirationTimerOptions.getName(seconds);
            return attrs;
        }
    });

    F.KeyChangeView = F.MessageItemView.extend({
        templateName: 'f-article-messages-keychange',

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
        className: 'ui feed messages',
        itemView: F.MessageItemView,

        events: {
            //'scroll': 'onScroll',
            //'reset-scroll': 'resetScrollPosition'
        },

        onScroll: function() {
            this.measureScrollPosition();
            if (this.$el.scrollTop() === this.el.scrollHeight) {
                console.info("XXX worked?");
                this.$el.trigger('loadMore');
            }
        },

        addAll: function() {
            this.$holder.html('');
            shuffle(this.collection.models);
            this.collection.each(this.addOne, this);
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
            //this.listenTo(view, 'beforeChangeHeight', this.measureScrollPosition);
            //this.listenTo(view, 'afterChangeHeight', this.scrollToLatestIfNeeded);
            const index = this.collection.indexOf(model);
            view.$el.attr('data-index', index);
            for (const x of this.$el.children()) {
                if (Number(x.dataset.index) < index) {
                    view.$el.insertBefore(x);
                    return;
                }
            }
            this.$el.append(view.$el);
        },
    });
})();

function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}
