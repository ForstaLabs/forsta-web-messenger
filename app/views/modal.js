// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.ModalView = F.View.extend({
        template: 'views/modal.html',
        className: 'ui modal',
        allowMultiple: false,
        closable: true,
        actions: [{label: 'Dismiss', class: 'approve'}],

        initialize: function(attrs) {
            attrs = Object.assign({
                header: this.header,
                icon: this.icon,
                footer: this.footer,
                actions: this.actions,
            }, attrs);
            if (attrs.content) {
                if (attrs.content instanceof Element) {
                    this.$content = $(attrs.content);
                } else if (attrs.content instanceof $) {
                    this.$content = attrs.content;
                }
                if (this.$content) {
                    delete attrs.content;
                }
            }
            this.staticRenderAttributes = attrs;
            // Allow some well used class and init props to be proxied into modalOptions.
            this.modalOptions = Object.assign({
                allowMultiple: attrs.allowMultiple === undefined ? this.allowMultiple : attrs.allowMultiple,
                closable: attrs.closable === undefined ? this.closable : attrs.closable
            }, attrs.modalOptions);
            /* NOTE, our onFoo methods wrap the optional modal option ones a user might 
             * provide.  This is a shallow copy of the incoming options to protect the user ones. */
            this.$el.modal(Object.assign({}, this.modalOptions, {
                onShow: this.onShow.bind(this),
                onHide: this.onHide.bind(this),
                onHidden: this.onHidden.bind(this),
                onApprove: this.onApprove.bind(this),
                onDeny: this.onDeny.bind(this)
            }));
            this.$el.addClass(attrs.size || this.size);
            this.$el.addClass(attrs.extraClass || this.extraClass);
        },

        render_attributes: async function() {
            return Object.assign({
                hasContent: !!(this.staticRenderAttributes.content || this.contentTemplate || this.$content),
            }, this.staticRenderAttributes);
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
                content = this.staticRenderAttributes.content;
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

        toggleLoading: function(active) {
            this.$('.ui.dimmer').dimmer(active ? 'show' : 'hide');
        },

        onShow: async function() {
            this.trigger('show', this);
            if (this.modalOptions.onShow) {
                await this.modalOptions.onShow.apply(this, arguments);
            }
        },

        onHide: async function() {
            this.trigger('hide', this);
            if (this.modalOptions.onHide) {
                await this.modalOptions.onHide.apply(this, arguments);
            }
        },

        onHidden: async function() {
            if (this.modalOptions.onHidden) {
                await this.modalOptions.onHidden.apply(this, arguments);
            }
            this.trigger('hidden', this);
            this.remove();
        },

        onApprove: async function() {
            this.trigger('approve', this);
            if (this.modalOptions.onApprove) {
                await this.modalOptions.onApprove.apply(this, arguments);
            }
        },

        onDeny: async function() {
            this.trigger('deny', this);
            if (this.modalOptions.onDeny) {
                await this.modalOptions.onDeny.apply(this, arguments);
            }
        }
    });
})();
