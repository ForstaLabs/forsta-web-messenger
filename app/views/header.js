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
            this.on('select-import-contacts', this.onImportContactsSelect);
            this.on('select-settings', this.onSettingsSelect);
            $('body').on('click', 'button.f-delete-device', this.onDeleteClick); // XXX move to it's own view
            this._onBodyClick = this.onBodyClick.bind(this);
        },

        events: {
            'click .f-toc': 'onTOCClick',
            'click .f-toc-menu .item[data-item]': 'onDataItemClick',
            'click .f-toc-menu .link': 'onLinkClick',
            'click .f-toc-menu a': 'onLinkClick'
        },

        render_attributes: async function() {
            return Object.assign({
                name: this.model.getName(),
                tagSlug: this.model.getTagSlug(/*forceFull*/ true),
                orgAttrs: (await this.model.getOrg()).attributes,
                avatar: {url: (await this.model.getAvatar()).url}, // Only send url to avoid double popup.
                admin: this.model.get('permissions').indexOf('org.administrator') !== -1
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            await this.updateAttention();
            this.$tocMenu = this.$('.f-toc-menu');
            return this;
        },

        updateAttention: async function() {
            const unreadCount = this.unread !== undefined ? this.unread :
                await F.state.get('unreadCount');
            const navCollapsed = this.navCollapsed !== undefined ? this.navCollapsed :
                await F.state.get('navCollapsed');
            const needAttention = !!(unreadCount && navCollapsed);
            const needFlash = this._lastUnreadCount !== undefined &&
                              this._lastUnreadCount !== unreadCount;
            this._lastUnreadCount = unreadCount;
            const $btn = this.$('.f-toggle-nav.button');
            $btn.toggleClass('attention', needAttention);
            if (needAttention) {
                $btn.attr('title', `${unreadCount} unread messages`);
                if (needFlash) {
                    navigator.vibrate && navigator.vibrate(200);
                    $btn.transition('pulse');
                }
            } else {
                $btn.attr('title', `Toggle navigation view`);
            }
        },

        updateUnreadCount: function(unread) {
            this.unread = unread;
            this.updateAttention();  // bg okay
        },

        updateNavCollapseState: function(collapsed) {
            this.navCollapsed = collapsed;
            this.updateAttention();  // bg okay
        },

        onTOCClick: function(ev) {
            ev.stopPropagation();  // Prevent clickaway detection from processing this.
            if (this.$tocMenu.hasClass('visible')) {
                this.hideTOC();
            } else {
                this.showTOC();
            }
        },

        hideTOC: function() {
            $('body').off('click', this._onBodyClick);
            this.$tocMenu.removeClass('visible');
        },

        showTOC: function() {
            this.$tocMenu.addClass('visible');
            $('body').on('click', this._onBodyClick);
        },

        onDataItemClick: function(ev) {
            const item = ev.currentTarget.dataset.item;
            if (item) {
                this.trigger(`select-${item}`);
            } else {
                console.warn("Bad toc menu item", ev.currentTarget);
            }
        },

        onLinkClick: function() {
            this.hideTOC();
        },

        onBodyClick: function(ev) {
            /* Detect clickaway */
            if (!$(ev.target).closest(this.$tocMenu).length) {
                this.hideTOC();
            }
        },

        onLogoutSelect: async function(e) {
            await F.util.confirmModal({
                icon: 'sign out',
                header: 'Logout from Forsta?',
                size: 'tiny',
                confirmClass: 'red'
            }) && await F.atlas.logout();
        },

        onDevicesSelect: async function(e) {
            const devices = await F.atlas.getDevices();
            const content = [
                '<table style="width: 100%">',
                    '<thead><tr>',
                        '<th>ID</th><th>Name</th><th>Last Seen</th><th>Created</th><th></th>',
                    '</tr></thead>'
            ];
            const dayMS = 86400 * 1000;
            const todayMS = Math.floor(Date.now() / dayMS) * dayMS;
            devices.sort((a, b) => {
                if (a.lastSeen === b.lastSeen) {
                    return a.created > b.created ? 0.1 : -0.1;
                } else {
                    return a.lastSeen < b.lastSeen ? 1 : -1;
                }
            });
            const blueCircle = ' <i class="icon circle small blue" title="This computer"></i>';
            for (const x of devices) {
                const lastSeenAgo = Math.max(todayMS - x.lastSeen, 0);
                const lastSeen = lastSeenAgo < dayMS * 1.5 ? 'Today' :
                    moment.duration(-lastSeenAgo).humanize(/*suffix*/ true);
                const us = Number(x.id) === F.currentDevice ? blueCircle : '';
                content.push([
                    '<tr>',
                        `<td>${x.id}${us}</td>`,
                        `<td>${x.name}</td>`,
                        `<td>${lastSeen}</td>`,
                        `<td>${moment(x.created).calendar()}</td>`,
                        '<td>',
                            `<button data-id="${x.id}" data-name="${x.name}" `,
                                    `data-last-seen="${lastSeen}" `,
                                    'class="f-delete-device ui button mini negative">',
                                'Delete',
                            '</button>',
                        '</td>',
                    '</tr>'
                ].join(''));
            }
            content.push('</table>');
            await F.util.promptModal({
                icon: 'microchip',
                header: 'Linked Devices',
                content: content.join('')
            });
        },

        onImportContactsSelect: async function(e) {
            await (new F.ImportContactsView()).show();
        },

        onSettingsSelect: async function(e) {
            await (new F.SettingsView()).show();
        },

        onDeleteClick: async function(ev) {
            const id = this.dataset.id;
            const name = this.dataset.name;
            const lastSeen = this.dataset.lastSeen;
            if (await F.util.confirmModal({
                icon: 'bomb red',
                header: `Delete device #${id}?`,
                content: `Do you really want to delete the device: <q><samp>${name}</samp></q>?`,
                footer: 'This device was last seen: ' + lastSeen,
                confirmClass: 'red'
            })) {
                const am = await F.foundation.getAccountManager();
                try {
                    await am.deleteDevice(id);
                } catch(e) {
                    F.util.promptModal({
                        icon: 'warning circle red',
                        header: `Error deleting device #${id}`,
                        content: e
                    });
                    throw e;
                }
                await F.util.promptModal({
                    icon: 'checkmark circle',
                    header: `Successfully deleted device #${id}`
                });
            }
        }
    });
})();
