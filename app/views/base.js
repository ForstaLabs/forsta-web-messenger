/*
 * vim: ts=4:sw=4:expandtab
 */
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

        delegateEvents: function() {
            if (this._rendered) {
                return Backbone.View.prototype.delegateEvents.call(this);
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
            if (html) {
                this.$el.html(html);
                this.$('[data-content], [data-html]').popup({
                    variation: 'small very wide',
                    observeChanges: true, // Buggy // XXX
                    position: 'bottom left',
                    delay: {
                        show: 1000,
                        hide: 200
                    }
                });
                const popupTpl = await F.tpl.fetch(F.urls.templates + 'util/user-popup.html');
                for (const el of this.$('[data-user-popup]')) {
                    const user = await F.ccsm.userLookup(el.dataset.userPopup);
                    if (!user) {
                        console.warn("User not found: popup will be broken");
                        continue;
                    }
                    const attrs = Object.assign({
                        name: user.getName(),
                        avatar: await user.getAvatar(),
                        slug: user.getSlug(),
                        fqslug: await user.getFQSlug(),
                        domain: (await user.getDomain()).attributes
                    }, user.attributes);
                    $(el).popup({
                        observeChanges: false, // Buggy
                        html: popupTpl(attrs),
                        on: el.dataset.userPopupEvent || 'click',
                        // Delay only affects hover.
                        delay: {
                            show: 800,
                            hide: 200
                        }
                    });
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
        }
    });

    F.ModalView = F.View.extend({
        template: 'util/modal.html',

        initialize: function(attrs) {
            this.render_attributes = attrs;
            this.options = attrs.options;
        },

        show: async function() {
            if (!this._rendered) {
                await this.render();
            }
            this.$modal = this.$('.ui.modal');
            if (this.options) {
                this.$modal.modal(this.options);
            }
            return this.$modal.modal('show');
        }
    });
})();
