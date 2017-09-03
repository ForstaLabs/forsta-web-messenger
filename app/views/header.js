 /*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};
            
    F.HeaderView = F.View.extend({
        template: 'views/menu.html',
        el: '#f-header-menu-view',

        initialize: function() {
            F.View.prototype.initialize.apply(this, arguments);
            this.on('select-logout', this.onLogoutSelect);
        },

        events: {
            'click .menu .f-user a.item': 'onUserMenuClick'
        },

        render_attributes: async function() {
            return Object.assign({
                name: this.model.getName(),
                slug: this.model.getSlug(),
                fqslug: await this.model.getFQSlug(),
                domain: (await this.model.getDomain()).attributes,
                avatar: {url: (await this.model.getAvatar()).url} // Only send url to avoid double popup.
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$('.ui.dropdown').dropdown();
            return this;
        },

        onUserMenuClick: function(e) {
            const item = e.currentTarget.dataset.item;
            if (item) {
                this.trigger(`select-${item}`);
            }
        },

        onLogoutSelect: async function(e) {
            await F.util.confirmModal({
                icon: 'eject',
                header: 'Logout from Forsta ?',
                confirmClass: 'red'
            }) && F.ccsm.logout();
        }
    });
})();
