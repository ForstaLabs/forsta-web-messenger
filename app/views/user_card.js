// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};

    F.UserCardView = F.View.extend({
        template: 'views/user-card.html',

        render_attributes: async function() {
            return Object.assign({
                name: this.model.getName(),
                avatar: await this.model.getAvatar(),
                tagSlug: this.model.getTagSlug(),
                orgAttrs: (await this.model.getOrg()).attributes,
                canMessage: !!F.mainView && !this.model.get('pending'),
                identityWords: await this.model.getIdentityWords(),
                identityQRCode: await this.model.getIdentityQRCode()
            }, this.model.attributes);
        },

        show: async function($source) {
            await this.render();
            if (!F.util.isSmallScreen() && $source && $source.length) {
                await this._showUserPopup($source);
            } else {
                await this._showUserModal();
            }
        },

        _showUserModal: async function() {
            this.$el.addClass('ui modal fullscreen basic');
            //const modalView = new F.View({className: 'ui modal fullscreen basic'});
            //modalView.$el.html(await this._renderUserCardTemplate(this.model));
            //modalView.$el.modal('show');
            this.$el.modal('show');
            if (F.util.isSmallScreen()) {
                F.ModalView.prototype.addPushState.call(this);
            }
            this.$el.on('click', ev => {
                /* Modal has a hidden surround that eats click events. We want
                 * to treat clicking in this area as a dismiss condition. */
                if (ev.target === this.el) {
                    this.$el.modal('hide');
                }
            });
            this.$el.on('click', '.f-dismiss', ev => this.$el.modal('hide'));
            this.$el.on('click', '.f-dm', async ev => {
                this.$('.ui.dimmer').addClass('active');
                try {
                    await this._openThread();
                } finally {
                    this.$el.modal('hide');
                }
            });
        },

        _showUserPopup: async function($source) {
            // Attempt a popup, but fallback to modal if it won't fit.
            const evIdent = '.f-user-card-' + this.cid; // XXX verify
            const $popup = $source.popup({
                observeChanges: false, // Buggy
                html: this.$el,
                onUnplaceable: () => {
                    $source.popup('hide all');
                    this._showUserModal();
                },
                onRemove: () => $(document).off('click' + evIdent),
                on: 'manual',
                exclusive: true
            }).popup('show').popup('get popup');
            $popup.on('click', '.f-dismiss', () => $source.popup('destroy'));
            $popup.on('click', '.f-dm', async ev => {
                $popup.find('.ui.dimmer').addClass('active');
                try {
                    await this._openThread();
                } finally {
                    $source.popup('destroy');
                }
            });
            // Register the clickaway detection outside this invocation because we likely
            // are in a click event this very moment.  Adding the click event listener
            // right now would catch the very same event and close the popup before the
            // user even saw it.
            setTimeout(() => $(document).on('click' + evIdent, ev => {
                // Look for clickaway props (e.g. click event out side popup.
                if (!$(ev.target).closest($popup).length) {
                    $source.popup('destroy');
                }
            }), 0);
        },

        _openThread: async function() {
            const threads = F.foundation.allThreads;
            const thread = await threads.ensure(this.model.getTagSlug(), {type: 'conversation'});
            await F.mainView.openThread(thread, /*skipHistory*/ true);
        }
    });
})();
