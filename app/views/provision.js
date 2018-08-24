// vim: ts=4:sw=4:expandtab
/* global moment */

(function () {
    'use strict';

    self.F = self.F || {};

    F.ProvisionView = F.ModalView.extend({
        
        contentTemplate: 'views/provision.html',
        extraClass: 'f-provision',
        closable: false,
        actionsFluid: true,

        events: {
            'click .f-reset.button': 'onResetClick',
            'click .f-generate.button': 'onGenerateClick',
            'click .f-provision.button': 'onProvisionClick',
            'click .f-abort.button': 'onAbortClick',
        },

        initialize: function(options) {
            const dayMS = 86400 * 1000;
            const todayMS = Math.floor(Date.now() / dayMS) * dayMS;
            const devices = Array.from(options.devices);
            if (devices.length) {
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
                options.actions = [{
                    icon: 'red warning sign',
                    label: 'Reset Identity Key',
                    title: 'WARNING: Removes existing devices!',
                    class: 'f-reset yellow large',
                }, {
                    icon: 'handshake',
                    label: 'Import Identity Key',
                    class: 'f-provision blue large',
                }];
            } else {
                options.actions = [{
                    icon: 'key',
                    label: 'Generate Identity Key',
                    class: 'f-generate blue large',
                }];
            }
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
            this.$('a.f-zendesk').popup({on: 'click'});
            return this;
        },

        provision: async function(initCallback, confirmCallback) {
            console.warn("Attempting to provision");
            this._provisioning = await F.foundation.autoProvision(initCallback, confirmCallback);
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
                await this.donePrompt();
            }
        },

        onGenerateClick: async function() {
            this.toggleLoading(true, 'Generating new Identity Key');
            try {
                await this.reset();
            } finally {
                this.toggleLoading(false);
            }
            this._finishedResolve();
            this.hide();
            await this.donePrompt();
        },

        donePrompt: async function() {
            await F.util.promptModal({
                icon: 'green thumbs up',
                header: 'Congratulations!',
                content: 'Everything looks good.  You\'re now ready to start using ' +
                         'secure end-to-end communications on this device.',
                size: 'tiny',
                dismissLabel: 'Continue'
            });
        },

        onProvisionClick: async function() {
            this.toggleLoading(true, `Starting provision request...<br/><br/>` +
                                     `<button class="f-abort ui button red">Abort</button>`);
            try {
                await this.provision(() => {
                    this.toggleLoading(true, `Contacted ${this.devices.length} device(s).<br/>` +
                                             `Waiting for responses...<br/><br/>` +
                                             `<button class="f-abort ui button red">Abort</button>`);
                }, () => this.toggleLoading(true, 'Processing response...'));
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
            await this.donePrompt();
        },

        onAbortClick: async function() {
            this._provisioning.cancel();
            this.toggleLoading(false);
        }
    });
})();
