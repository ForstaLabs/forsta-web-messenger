// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.ModalView = F.View.extend({
        template: 'views/modal.html',

        className: 'ui modal',

        initialize: function(attrs) {
            this.render_attributes = attrs || {};
            this.options = this.render_attributes.options || {};
        },

        render: async function() {
            const size = this.render_attributes.size || 'small';
            this.$el.addClass(size);
            return await F.View.prototype.render.apply(this, arguments);
        },

        show: async function() {
            if (!this._rendered) {
                await this.render();
            }
            if (this.options) {
                const overrides = Object.assign({}, this.options);
                overrides.onShow = this.onShow.bind(this);
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

        onShow: function() {
            this.trigger('show', this);
            if (this.options && this.options.onShow) {
                this.options.onShow.apply(this, arguments);
            }
        },

        onHidden: function() {
            this.trigger('hidden', this);
            if (this.options && this.options.onHidden) {
                this.options.onHidden.apply(this, arguments);
            }
        },

        onApprove: function() {
            this.trigger('approve', this);
            if (this.options && this.options.onApprove) {
                this.options.onApprove.apply(this, arguments);
            }
        },

        onDeny: function() {
            this.trigger('deny', this);
            if (this.options && this.options.onDeny) {
                this.options.onDeny.apply(this, arguments);
            }
        }
    });
})();
