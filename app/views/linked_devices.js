// vim: ts=4:sw=4:expandtab
/* global moment */

(function () {
    'use strict';

    self.F = self.F || {};

    F.LinkedDevicesView = F.View.extend({
        template: 'views/linked-devices.html',

        className: 'f-linked-devices ui modal small',

        events: {
            'click .f-revoke': 'onRevokeClick',
            'click .f-dismiss': 'onDismiss'
        },

        iconClass: function(device) {
            if (device.platform) {
                const p = device.platform;
                if (p.match(/iPad/) ||
                    (p.match(/Android/) && !p.match(/Mobile/))) {
                    return 'tablet';
                } else if (p.match(/iPhone|Android|Mobile/)) {
                    return 'mobile';
                } else {
                    return 'laptop';
                }
            } else {
                const n = device.name;
                if (n.match(/iPad/)) {
                    return 'tablet';
                } else if (n.match(/iPhone|Android/)) {
                    return 'mobile';
                } else if (n.match(/Linux/)) {
                    return 'desktop';
                } else {
                    return 'laptop';
                }
            }
        },

        render_attributes: async function() {
            const devices = await F.atlas.getDevices();
            const dayMS = 86400 * 1000;
            const todayMS = Math.floor(Date.now() / dayMS) * dayMS;
            for (const x of devices) {
                const lastSeenAgo = Math.max(todayMS - x.lastSeen, 0);
                x.lastSeenPretty = lastSeenAgo < dayMS * 1.5 ? 'Today' :
                    moment.duration(-lastSeenAgo).humanize(/*suffix*/ true);
                x.iconClass = this.iconClass(x);
                x.old = lastSeenAgo > dayMS * 7;
            }
            devices.sort((a, b) => {
                if (a.lastSeen === b.lastSeen) {
                    return a.created > b.created ? 0.1 : -0.1;
                } else {
                    return a.lastSeen < b.lastSeen ? 1 : -1;
                }
            });
            this.deviceMap = new Map(devices.map(x => [x.id, x]));
            const ourDevice = devices.find(x => x.id === F.currentDevice);
            return {
                ourDevice,
                devices: devices.filter(x => x.id !== F.currentDevice)
            };
        },

        onRevokeClick: async function(ev) {
            const row = $(ev.currentTarget).closest('.row');
            const device = this.deviceMap.get(row.data('id'));
            const isSelf = device.id === F.currentDevice;
            if (await F.util.confirmModal({
                allowMultiple: true,
                icon: isSelf ? 'trash' : 'bomb',
                size: 'tiny',
                header: "Revoke Device Access?",
                content: `Please confirm that you want to revoke access to device:<br/>  ` +
                         `<q><samp>#${device.id} - ${device.name}</samp></q>.`,
                footer: 'This device was last seen: ' + device.lastSeenPretty,
                confirmLabel: 'Revoke',
                confirmClass: 'red'
            })) {
                const am = await F.foundation.getAccountManager();
                try {
                    await am.deleteDevice(device.id);
                } catch(e) {
                    F.util.promptModal({
                        allowMultiple: true,
                        size: 'tiny',
                        icon: 'warning circle red',
                        header: `Error deleting device #${device.id}`,
                        content: e
                    });
                    throw e;
                }
                if (isSelf) {
                    await F.state.remove('registered');
                    location.reload();
                } else {
                    await this.render();
                }
            }
        },

        onDismiss: function(ev) {
            this.hide();
        },

        show: async function() {
            if (!this._rendered) {
                await this.render();
            }
            this.$el.modal('show');
            if (F.util.isSmallScreen()) {
                F.ModalView.prototype.addPushState.call(this);
            }
        },

        hide: function() {
            this.$el.modal('hide');
        }
    });
})();
