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
            this.selectStep('start');
            this.$syncProgress = this.$('.ui.progress');
            this.$downloading = this.$('f-downloading');
            return this;
        },

        clearQR: function() {
            this.$('#qr').text('Connecting...');
        },

        setProvisioningUrl: function(url) {
            this.$('#qr').html('');
            new QRCode(this.$('#qr')[0]).makeCode(url);
        },

        onConfirmNumber: async function(number) {
            this.selectStep('sync');
            return this.deviceName;
        },

        onProgress: function(i) {
            this.$syncProgress.progress({percent: i});
        },

        onSyncDone: function() {
            /* This callback fires prematurely.  The storage system
             * is asyncronous.  We need a UX timing hack to dance around it. */
            this.selectStep('finish', true);
            setTimeout(() => location.assign(F.urls.main), 5000);
        },

        onSyncTimeout: function() {
            this.showConnectionError();
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
                    this.onConfirmNumber.bind(this),
                    this.onProgress.bind(this));
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
            this.selectStep('download');
            await F.foundation.initInstaller();
            const recv = F.foundation.getMessageReceiver();
            recv.addEventListener('error', this.showConnectionError.bind(this));
            const sync = F.foundation.syncRequest();
            sync.addEventListener('success', this.onSyncDone.bind(this));
            sync.addEventListener('timeout', this.onSyncTimeout.bind(this));
        }
    });
})();
