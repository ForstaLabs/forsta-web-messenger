// vim: ts=4:sw=4:expandtab
/* global QRCode */

(function () {
    'use strict';

    self.F = self.F || {};

    F.InstallView = F.View.extend({
        initialize: function(options) {
            this.deviceName = options.deviceName;
            this.accountManager = options.accountManager;
            this.registered = options.registered;
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            if (this.registered) {
                this.$('#f-already-registered').removeClass('hidden');
            }
            this.clearQR();
            this.$progress = this.$('.ui.progress');
            this.selectStep('start');
            return this;
        },

        clearQR: function() {
            this.$('#qr').text('Connecting...');
        },

        setProvisioningUrl: function(url) {
            this.$('#qr').html('');
            new QRCode(this.$('#qr')[0]).makeCode(url);
            console.info('/link', url);
        },

        onConfirmAddress: async function(addr) {
            if (addr !== F.currentUser.id) {
                await F.util.promptModal({
                    icon: 'red warning sign',
                    header: 'User Identity Mismatch',
                    content: 'You must be logged into Forsta using the same user identity ' +
                             'on both devices.'
                });
                location.assign('.');
                // location.assign is async; Prevent continuation.
                await F.util.never();
            }
            this.selectStep('sync');
            return this.deviceName;
        },

        onKeyProgress: function(i) {
            // Arbitrarily allocate 80% of progress bar to key generation.  Save 20% for DB cooldown.
            this.$progress.progress({percent: i * 0.80});
        },

        cooldown: async function() {
            /* The register*Device funcs return prematurely.  The storage system
             * is asynchronous.  We need a UX timing hack to dance around it. */
            const cooldown = 2; // seconds
            for (let i = 80; i <= 100; i++) {
                this.$progress.progress({percent: i});
                await F.util.sleep(cooldown / 20);
            }
            await F.util.sleep(1);
            location.assign(F.urls.main);
        },

        selectStep: function(id, completed) {
            const panel = this.$(`.panel[data-step="${id}"]`);
            panel.siblings().removeClass('active');
            panel.addClass('active');
            const step = this.$(`.step[data-step="${id}"]`);
            const sibs = step.siblings();
            const behind = step.prevAll();
            const ahead = step.nextAll();
            sibs.removeClass('active');
            sibs.addClass('disabled');
            behind.addClass('completed');
            ahead.removeClass('completed');
            step.addClass('active');
            step.removeClass('disabled');
            if (completed) {
                step.addClass('completed');
            }
        },

        showModal: function($el, closable) {
            $el.modal({closable: !!closable}).modal('show');
        },

        showTooManyDevices: function() {
            this.showModal($('#f-too-many-devices'));
        },

        showConnectionError: function() {
            this.showModal($('#f-connection-error'));
        },

        registerDevice: async function() {
            try {
                await this.accountManager.registerDevice(
                    this.setProvisioningUrl.bind(this),
                    this.onConfirmAddress.bind(this),
                    this.onKeyProgress.bind(this));
            } catch(e) {
                if (e.message === 'websocket closed') {
                    this.showConnectionError();
                } else if (e instanceof textsecure.ProtocolError && e.code == 411) {
                    this.showTooManyDevices();
                } else {
                    throw e;
                }
                return;
            }
            this.cooldown();
        }
    });
})();
