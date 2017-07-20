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
            this.$keyProgress = this.$('.ui.progress');
            this.selectStep('start');
            return this;
        },

        clearQR: function() {
            this.$('#qr').text('Connecting...');
        },

        setProvisioningUrl: function(url) {
            this.$('#qr').html('');
            new QRCode(this.$('#qr')[0]).makeCode(url);
        },

        onConfirmPhone: async function() {
            this.selectStep('sync');
            return this.deviceName;
        },

        onKeyProgress: function(i) {
            this.$keyProgress.progress({percent: i});
        },

        finish: async function() {
            /* This callback fires prematurely.  The storage system
             * is asynchronous.  We need a UX timing hack to dance around it. */
            const countdown = this.$('.f-countdown .value');
            this.selectStep('finish', true);
            for (let i = 2; i; i--) {
                await F.util.sleep(0.700);
                countdown.css('opacity', '0');
                await F.util.sleep(0.300); // match stylesheet transition
                countdown.html(i);
                countdown.css('opacity', '1');
            }
            this.$('.f-countdown .label').html("second");
            await F.util.sleep(0.700);
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
                await this.accountManager.registerSecondDevice(
                    this.setProvisioningUrl.bind(this),
                    this.onConfirmPhone.bind(this),
                    this.onKeyProgress.bind(this));
            } catch(e) {
                if (e.message === 'websocket closed') {
                    this.showConnectionError();
                } else if (e.name === 'HTTPError' && e.code == 411) {
                    this.showTooManyDevices();
                } else {
                    throw e;
                }
                return;
            }
            this.selectStep('finish');
            this.finish();
        }
    });
})();
