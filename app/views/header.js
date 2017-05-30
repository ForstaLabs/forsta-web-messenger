 /*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};
            
    F.HeaderView = F.View.extend({
        templateName: 'f-header-menu',
        el: '#f-header-menu-view',

        events: {
            'click .menu .f-toc a.item': 'onTOCMenuClick',
            'click .menu .f-user a.item': 'onUserMenuClick'
        },

        render: function() {
            F.View.prototype.render.apply(this, arguments);
            this.$el.find('.ui.dropdown').dropdown();
        },

        onTOCMenuClick: function(e) {
            const item = $(e.currentTarget);
            console.log('fun stuff for menu', item);
        },

        onUserMenuClick: async function(e) {
            const item = $(e.currentTarget);
            const m = await F.tpl.render('f-modal-profile', this.model.attributes);
            m.modal({blurring: true}).modal('show');
        }
    });
})();
