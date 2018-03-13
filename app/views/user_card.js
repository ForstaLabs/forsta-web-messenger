// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};

    F.UserCardView = F.View.extend({
        template: 'views/user-card.html',
        className: 'ui modal fullscreen basic',

        events: {
            'click': 'onModalClick',
            'click .f-dismiss': 'onDismissClick',
            'click .f-dm': 'onDirectMessageClick',
            'click .f-flag.button': 'onFlagIdentityClick',
            'click .f-untrust.button': 'onUntrustIdentityClick',
            'click .f-accept.button': 'onAcceptIdentityClick'
        },

        render_attributes: async function() {
            const trustedIdent = await this.model.getTrustedIdentity();
            return Object.assign({
                name: this.model.getName(),
                avatar: await this.model.getAvatar({size: 'large'}),
                tagSlug: this.model.getTagSlug(),
                orgAttrs: (await this.model.getOrg()).attributes,
                canMessage: !!F.mainView && !this.model.get('pending'),
                hasIdentityKey: !!(await this.model.getIdentityKey()),
                trustedIdentity: trustedIdent && trustedIdent.attributes,
                proposedIdentityPhrase: await this.model.getIdentityPhrase(/*proposed*/ true),
                identityPhrase: await this.model.getIdentityPhrase(),
                isCurrentUser: this.model.id === F.currentUser.id
            }, this.model.attributes);
        },

        render: async function() {
            await F.View.prototype.render.apply(this, arguments);
            this.$('.ui.checkbox').checkbox({onChange: this.onTrustedChange.bind(this)});
            return this;
        },

        show: async function() {
            await this.render();
            this.$el.modal('show');
            if (F.util.isSmallScreen()) {
                F.ModalView.prototype.addPushState.call(this);
            }
        },

        onTrustedChange: async function() {
            const checked = this.$('.ui.checkbox input').is(':checked');
            if (checked) {
                await this.model.updateTrustedIdentity();
            } else {
                await this.model.destroyTrustedIdentity();
            }
        },

        onModalClick: function(ev) {
            /* Modal has a hidden surround that eats click events. We want
             * to treat clicking in this area as a dismiss condition. */
            if (ev.target === this.el) {
                this.$el.modal('hide');
            }
        },

        onDismissClick: function(ev) {
            this.$el.modal('hide');
        },

        onDirectMessageClick: async function(ev) {
            this.$('.ui.dimmer').addClass('active');
            try {
                await this._openThread();
            } finally {
                this.$el.modal('hide');
            }
        },

        onFlagIdentityClick: async function() {
            F.util.reportError("Bad Actor: " + this.model);
            await F.util.promptModal({
                header: 'Contact Flagged',
                content: 'This contact has been flagged as a "Bad Actor".  Our administrators ' +
                         'have been notified of the suspicious activity'
            });
        },

        onUntrustIdentityClick: async function(ev) {
            await this.model.destroyTrustedIdentity();
            await this.render();
        },

        onAcceptIdentityClick: async function() {
            await this.model.updateTrustedIdentity(/*proposed*/ true);
            await this.render();
        },

        _openThread: async function() {
            const threads = F.foundation.allThreads;
            const thread = await threads.ensure(this.model.getTagSlug(), {type: 'conversation'});
            await F.mainView.openThread(thread, /*skipHistory*/ true);
        }
    });
})();
