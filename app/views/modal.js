// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.ModalView = F.View.extend({
        template: 'views/modal.html',

        className: 'ui modal',

        initialize: function(attrs) {
            this.render_attributes = attrs;
            this.options = attrs.options;
        },

        render: async function() {
            if (this.render_attributes.size) {
                this.$el.addClass(this.render_attributes.size);
            }
            return await F.View.prototype.render.apply(this, arguments);
        },

        show: async function() {
            if (!this._rendered) {
                await this.render();
            }
            if (this.options) {
                this.$el.modal(this.options);
            }
            return this.$el.modal('show');
        },

        hide: async function() {
            return this.$el.modal('hide');
        }
    });
})();
