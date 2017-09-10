 // vim: ts=4:sw=4:expandtab
 /* global moment */

(function () {
    'use strict';

    self.F = self.F || {};
            
    F.HeaderView = F.View.extend({
        template: 'views/header.html',

        initialize: function() {
            F.View.prototype.initialize.apply(this, arguments);
            this.on('select-logout', this.onLogoutSelect);
            this.on('select-devices', this.onDevicesSelect);
        },

        events: {
            'click .menu .f-user a.item[data-item]': 'onUserMenuClick'
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
        },

        onDevicesSelect: async function(e) {
            const am = await F.foundation.getAccountManager();
            const devices = await am.server.getDevices();
            const content = [
                '<table style="width: 100%">',
                    '<thead><tr>',
                        '<th>ID</th><th>Name</th><th>Last Seen</th><th>Created</th>',
                    '</tr></thead>'
            ];
            for (const x of devices) {
                content.push(`<tr><td>${x.id}</td><td>${x.name}</td>` +
                             `<td>${moment(x.lastSeen).fromNow()}</td>` +
                             `<td>${moment(x.created).calendar()}</td></tr>`);
            }
            content.push('</table>');
            await F.util.promptModal({
                icon: 'microchip',
                header: 'Linked Devices',
                content: content.join('')
            });
        }
    });
})();
