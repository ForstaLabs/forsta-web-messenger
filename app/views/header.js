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
            this.on('select-org', this.onOrgSelect);
        },

        events: {
            'click .menu .f-user a.item': 'onUserMenuClick'
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$el.find('.ui.dropdown').dropdown();
            return this;
        },

        onUserMenuClick: function(e) {
            const item = e.currentTarget.dataset.item;
            if (item) {
                this.trigger(`select-${item}`);
            }
        },

        onLogoutSelect: async function(e) {
            const view = new F.LogoutView();
            await view.render();
            view.$el.modal({
                onHidden: view.remove.bind(view),
                onApprove: F.ccsm.logout
            }).modal('show');
        },

        onProfileSelect: async function(e) {
            const view = new F.ProfileView({model: this.model});
            await view.render();
            view.$el.modal({
                onHidden: view.remove.bind(view)
            }).modal('show');
        },

        onOrgSelect: async function(e) {
            const view = new F.OrgView({model: this.model});
            await view.render();
            view.$el.modal({
                onHidden: view.remove.bind(view)
            }).modal('show');
        }
    });

    F.LogoutView = F.View.extend({
        template: 'header/logout.html',
        templateRootAttach: true
    });

    F.ProfileView = F.View.extend({
        template: 'header/profile.html',
        templateRootAttach: true
    });

    F.OrgView = F.View.extend({
        template: 'header/org.html',
        templateRootAttach: true
    });
})();
