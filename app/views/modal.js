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
                this.$el.modal(this.options);
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
            const pushStateId = F.util.uuid4();
            this.el.dataset.pushStateId = pushStateId;
            F.router.addState({showModal: pushStateId});
        }
    });
})();
