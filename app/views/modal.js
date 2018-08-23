// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.ModalView = F.View.extend({
        template: 'views/modal.html',
        className: 'ui modal',
        allowMultiple: false,
        closable: true,
        confirmHide: true,
        dismissHide: true,
        scrolling: true,
        actions: [{label: 'Dismiss', class: 'approve'}],
        actionsFluid: false,

        initialize: function(settings) {
            settings = Object.assign({
                header: this.header,
                icon: this.icon,
                footer: this.footer,
                actions: this.actions,
                actionsFluid: this.actionsFluid,
                confirmHide: this.confirmHide,
                dismissHide: this.dismissHide,
                scrolling: this.scrolling,
            }, settings);
            if (settings.content) {
                if (settings.content instanceof Element) {
                    this.$content = $(settings.content);
                } else if (settings.content instanceof $) {
                    this.$content = settings.content;
                }
                if (this.$content) {
                    delete settings.content;
                }
            }
            this.settings = settings;
            // Allow some well used class and init props to be proxied into modalOptions.
            this.modalOptions = Object.assign({
                allowMultiple: settings.allowMultiple === undefined ? this.allowMultiple : settings.allowMultiple,
                closable: settings.closable === undefined ? this.closable : settings.closable
            }, settings.modalOptions);
            /* NOTE, our onFoo methods wrap the optional modal option ones a user might 
             * provide.  This is a shallow copy of the incoming options to protect the user ones. */
            this.$el.modal(Object.assign({}, this.modalOptions, {
                onShow: this.onShow.bind(this),
                onHide: this.onHide.bind(this),
                onHidden: this.onHidden.bind(this),
                onApprove: this.onApprove.bind(this),
                onDeny: this.onDeny.bind(this)
            }));
            this.$el.addClass(settings.size || this.size);
            this.$el.addClass(settings.extraClass || this.extraClass);
        },

        render_attributes: async function() {
            return Object.assign({
                hasContent: !!(this.settings.content || this.contentTemplate || this.$content),
            }, this.settings);
        },

        renderContentTemplate: async function() {
            if (!this._contentTemplate && this.contentTemplate) {
                this._contentTemplate = await F.tpl.fetch(F.urls.templates + this.contentTemplate);
            }
            if (this._contentTemplate) {
                const attrs = await _.result(this, 'render_attributes', {});
                return this._contentTemplate(attrs);
            }
        },

        render: async function() {
            let content;
            if (this.contentTemplate) {
                content = await this.renderContentTemplate();
            } else {
                content = this.settings.content;
            }
            const overrides = content ? {content} : null;
            await F.View.prototype.render.call(this, {overrides});
            if (this.$content) {
                const $contentAnchor = this.$('.f-content-anchor');
                if (!$contentAnchor.children().length) {
                    $contentAnchor.append(this.$content);
                }
            }
            return this;
        },

        show: async function() {
            await this.render();
            this.$el.modal('show');
            if (F.util.isSmallScreen()) {
                this.addPushState();
            }
        },

        hide: function() {
            return this.$el.modal('hide');
        },

        addPushState: function() {
            if (F.router) {
                const pushStateId = F.util.uuid4();
                this.el.dataset.pushStateId = pushStateId;
                F.router.addState({showModal: pushStateId});
            }
        },

        toggleLoading: function(activate, html) {
            const $dimmer = this.$('> .ui.dimmer');
            if (activate == null) {
                activate = !$dimmer.dimmer('is active');
            }
            if (html) {
                $dimmer.children('.ui.loader').addClass('text').html(html);
            } else {
                $dimmer.children('.ui.loader').removeClass('text').html('');
            }
            $dimmer.dimmer(activate ? 'show' : 'hide');
        },

        onShow: async function() {
            this.trigger('show', this);
            if (this.modalOptions.onShow) {
                await this.modalOptions.onShow.apply(this, arguments);
            }
        },

        onHide: function() {
            // Returning false will prevent close.
            this.trigger('hide', this);
            if (this.modalOptions.onHide) {
                return this.modalOptions.onHide.apply(this, arguments);
            }
        },

        onApprove: function() {
            // Returning false will prevent close.
            this.trigger('approve', this);
            if (this.modalOptions.onApprove) {
                if (this.modalOptions.onApprove.apply(this, arguments) === false) {
                    return false;  // prevent hide
                }
            }
            return this.settings.confirmHide;
        },

        onDeny: function() {
            // Returning false will prevent close.
            this.trigger('deny', this);
            if (this.modalOptions.onDeny) {
                if (this.modalOptions.onDeny.apply(this, arguments) === false) {
                    return false;  // prevent hide
                }
            }
            return this.settings.dismissHide;
        },

        onHidden: async function() {
            if (this.modalOptions.onHidden) {
                await this.modalOptions.onHidden.apply(this, arguments);
            }
            this.trigger('hidden', this);
            this.remove();
        }
    });
})();
