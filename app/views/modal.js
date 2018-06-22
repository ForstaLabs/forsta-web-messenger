// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.ModalView = F.View.extend({
        template: 'views/modal.html',
        className: 'ui modal',

        initialize: function(attrs) {
            attrs = Object.assign({}, attrs);
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
            attrs.hasContent = !!(this.$content || attrs.content);
            this.staticRenderAttributes = attrs;
            this.options = attrs.options || {};
        },

        render_attributes: function() {
            return this.staticRenderAttributes;
        },

        render: async function() {
            const size = this.staticRenderAttributes.size;
            if (size) {
                this.$el.addClass(size);
            }
            await F.View.prototype.render.call(this);
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
            if (this.options) {
                const overrides = Object.assign({}, this.options);
                overrides.onShow = this.onShow.bind(this);
                overrides.onHide = this.onHide.bind(this);
                overrides.onHidden = this.onHidden.bind(this);
                overrides.onApprove = this.onApprove.bind(this);
                overrides.onDeny = this.onDeny.bind(this);
                this.$el.modal(overrides);
            }
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

        onShow: async function() {
            this.trigger('show', this);
            if (this.options && this.options.onShow) {
                await this.options.onShow.apply(this, arguments);
            }
        },

        onHide: async function() {
            this.trigger('hide', this);
            if (this.options && this.options.onHide) {
                await this.options.onHide.apply(this, arguments);
            }
        },

        onHidden: async function() {
            if (this.options && this.options.onHidden) {
                await this.options.onHidden.apply(this, arguments);
            }
            this.trigger('hidden', this);
            this.remove();
        },

        onApprove: async function() {
            this.trigger('approve', this);
            if (this.options && this.options.onApprove) {
                await this.options.onApprove.apply(this, arguments);
            }
        },

        onDeny: async function() {
            this.trigger('deny', this);
            if (this.options && this.options.onDeny) {
                await this.options.onDeny.apply(this, arguments);
            }
        }
    });
})();
