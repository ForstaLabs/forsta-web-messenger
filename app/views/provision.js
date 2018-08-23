// vim: ts=4:sw=4:expandtab
/* global moment, relay */

(function () {
    'use strict';

    self.F = self.F || {};

    F.ProvisionView = F.ModalView.extend({
        
        contentTemplate: 'views/provision.html',
        extraClass: 'f-provision',
        closable: false,
        actionsFluid: true,
        actions: [{
            icon: 'red warning sign',
            label: 'Generate New Identity Key',
            title: 'WARNING: Removes any existing devices',
            class: 'f-reset yellow large',
        }, {
            icon: 'handshake',
            label: 'Start Identity Key Transfer',
            class: 'f-provision blue large',
        }],

        events: {
            'click .f-reset.button': 'onResetClick',
            'click .f-provision.button': 'onProvisionClick',
            'click .f-abort.button': 'onAbortClick',
        },

        initialize: function(options) {
            const dayMS = 86400 * 1000;
            const todayMS = Math.floor(Date.now() / dayMS) * dayMS;
            const devices = Array.from(options.devices);
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
            this.devices = devices;
            this.finished = new Promise((resolve, reject) => {
                this._finishedResolve = resolve;
                this._finishedReject = reject;
            });
            return F.ModalView.prototype.initialize.call(this, options);
        },

        iconClass: function(device) {
            if (device.platform) {
                const p = device.platform;
                if (p.match(/iPad/) ||
                    (p.match(/Android/) && !p.match(/Mobile/))) {
                    return 'tablet';
                } else if (p.match(/iPhone|Android|Mobile/)) {
                    return 'mobile';
                } else if (p.match(/Linux/)) {
                    return 'desktop';
                } else if (p.match(/librelay/)) {
                    return 'server';
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
                } else if (n.match(/librelay/)) {
                    return 'server';
                } else {
                    return 'laptop';
                }
            }
        },

        render_attributes: async function() {
            const welcomeImage = _.sample([
                F.util.versionedURL('/@static/images/clipart/man-hello.svg'),
                F.util.versionedURL('/@static/images/clipart/man2-hello.svg'),
            ]);
            return Object.assign({
                devices: this.devices,
                kb: {
                    identityKey: await F.util.fetchZendeskArticle(360008370274)
                },
                welcomeImage
            }, await F.ModalView.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            await F.ModalView.prototype.render.apply(this, arguments);
            this.$('[data-html]').popup();
            return this;
        },

        provision: async function() {
            console.warn("Attempting to provision");
            this._provisioning = await F.foundation.autoProvision()
            await this._provisioning.done;
        },

        reset: async function() {
            console.warn("Creating/resetting account for:", F.currentUser.id);
            const am = await F.foundation.getAccountManager();
            await am.registerAccount(F.foundation.generateDeviceName());
        },

        onResetClick: async function() {
            if (await F.util.confirmModal({
                icon: 'red warning sign',
                header: 'Confirm account reset',
                content: 'Are you sure you wish to generate a new Identity Key ' +
                         'and reset your account?  This step cannot be undone ' +
                         'and will trigger security alarms for any trusted contacts.',
                allowMultiple: true,
                size: 'tiny',
                confirmClass: 'red',
                confirmLabel: 'Reset Account',
                dismissLabel: 'Cancel'
            })) {
                this.toggleLoading(true, 'Resetting account for: ' + F.currentUser.getTagSlug(true));
                try {
                    await this.reset();
                } finally {
                    this.toggleLoading(false);
                }
                this._finishedResolve();
                this.hide();
            }
        },

        onProvisionClick: async function() {
            this.toggleLoading(true, `Sending identity key transfer request to ` +
                                     `${this.devices.length} device(s). <br/><br/>` +
                                     `<button class="f-abort ui button red">Abort</button>`);
            try {
                await this.provision();
            } catch(e) {
                F.util.reportError("Failed to auto provision.", {error: e});
                await F.util.confirmModal({
                    icon: 'stop red',
                    header: 'Provision Error',
                    content: e.message,
                    allowMultiple: true
                });
            } finally {
                this.toggleLoading(false);
            }
            this._finishedResolve();
            this.hide();
        },

        onAbortClick: async function() {
            this._provisioning.cancel();
            this.toggleLoading(false);
        }
    });
})();
