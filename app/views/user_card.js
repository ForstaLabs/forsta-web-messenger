// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function () {
    'use strict';

    self.F = self.F || {};

    const FViewOptions = [
        'template', // Path to template file following F.urls.templates/
    ];

    F.View = Backbone.View.extend({
        constructor: function(options) {
            _.extend(this, _.pick(options, FViewOptions));
            return Backbone.View.prototype.constructor.apply(this, arguments);
        },

        delegateEvents: function(events) {
            if (this._rendered) {
                events = events || _.result(this, 'events') || {};
                events['click [data-user-card]'] = 'onUserCardClick';
                return Backbone.View.prototype.delegateEvents.call(this, events);
            } else {
                return this;
            }
        },

        render: async function() {
            const html = await this.render_template();
            if (this._rendered && html === this._lastRender) {
                return this;
            }
            this._lastRender = html;
            if (html !== undefined) {
                for (const el of this.$el) {
                    el.innerHTML = html;
                }
            }
            this._rendered = true;
            this.delegateEvents();
            return this;
        },

        setElement: function() {
            /* Clear lastRender cache given that we have a new element to append to. */
            this._lastRender = null;
            return Backbone.View.prototype.setElement.apply(this, arguments);
        },

        render_template: async function() {
            if (!this._template && this.template) {
                this._template = await F.tpl.fetch(F.urls.templates + this.template);
            }
            if (this._template) {
                const attrs = await _.result(this, 'render_attributes', {});
                return this._template(attrs);
            }
        },

        render_attributes: function() {
            /* Return a shallow copy of the model attributes. */
            return Object.assign({}, _.result(this.model, 'attributes', {}));
        },

        onUserCardClick: async function(ev) {
            ev.stopPropagation();  // Nested views produce spurious events.
            const $source = $(ev.currentTarget);
            const user = (await F.atlas.getContacts([$source.data('user-card')]))[0];
            if (!user) {
                console.warn("User not found: card broken");
                return; // XXX Could probably just tell the user something...
            }
            if (!F.util.isSmallScreen()) {
                await this._showUserPopup($source, user);
            } else {
                await this._showUserModal(user);
            }
        },

        _renderUserCardTemplate: async function(user) {
            const cardTpl = await F.tpl.fetch(F.urls.templates + 'util/user-card.html');
            return cardTpl(Object.assign({
                name: user.getName(),
                avatar: await user.getAvatar(),
                tagSlug: user.getTagSlug(),
                orgAttrs: (await user.getOrg()).attributes,
                canMessage: !!F.mainView && !user.get('pending'),
                identityWords: await user.getIdentityWords(),
                identityQRCode: await user.getIdentityQRCode()
            }, user.attributes));
        },

        _showUserModal: async function(user) {
            const modalView = new F.View({className: 'ui modal fullscreen basic'});
            modalView.$el.html(await this._renderUserCardTemplate(user));
            modalView.$el.modal('show');
            if (F.util.isSmallScreen()) {
                F.ModalView.prototype.addPushState.call(modalView);
            }
            const $modal = modalView.$el;
            $modal.on('click', ev => {
                /* Modal has a hidden surround that eats click events. We want
                 * to treat clicking in this area as a dismiss condition. */
                if (ev.target === $modal[0]) {
                    $modal.modal('hide');
                }
            });
            $modal.on('click', '.f-dismiss', ev => $modal.modal('hide'));
            $modal.on('click', '.f-dm', async ev => {
                $modal.find('.ui.dimmer').addClass('active');
                try {
                    await this._openThread(user);
                } finally {
                    $modal.modal('hide');
                }
            });
        },

        _showUserPopup: async function($source, user) {
            // Attempt a popup, but fallback to modal if it won't fit.
            const evIdent = '.' + Date.now() + (parseInt(Math.random() * 1000000));
            const $popup = $source.popup({
                observeChanges: false, // Buggy
                html: await this._renderUserCardTemplate(user),
                onUnplaceable: () => {
                    $source.popup('hide all');
                    this._showUserModal(user);
                },
                onRemove: () => $(document).off('click' + evIdent),
                on: 'manual',
                exclusive: true
            }).popup('show').popup('get popup');
            $popup.on('click', '.f-dismiss', () => $source.popup('destroy'));
            $popup.on('click', '.f-dm', async ev => {
                $popup.find('.ui.dimmer').addClass('active');
                try {
                    await this._openThread(user);
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

        _openThread: async function(user) {
            const threads = F.foundation.allThreads;
            const thread = await threads.ensure(user.getTagSlug(), {type: 'conversation'});
            await F.mainView.openThread(thread, /*skipHistory*/ true);
        }
    });
})();
