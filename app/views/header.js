 /*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};
            
    F.HeaderView = F.View.extend({
        template: 'header/menu.html',
        el: '#f-header-menu-view',

        initialize: function() {
            F.View.prototype.initialize.apply(this, arguments);
            this.on('select-logout', this.onLogoutSelect);
            this.on('select-profile', this.onProfileSelect);
        },

        events: {
            'click .menu .f-user a.item': 'onUserMenuClick'
        },

        render_attributes: function() {
            return Object.assign({
                avatar: this.model.getAvatar()
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
        },

        onProfileSelect: async function(e) {
            const view = new F.ProfileView({model: this.model});
            await view.render();
            view.$el.modal({
                onHidden: view.remove.bind(view)
            }).modal('show');
        }
    });

    F.ProfileView = F.View.extend({
        template: 'header/profile.html',
        templateRootAttach: true,

        render_attributes: function() {
            return Object.assign({
                avatar: this.model.getAvatar()
            }, F.View.prototype.render_attributes.apply(this, arguments));
        }
    });
})();
