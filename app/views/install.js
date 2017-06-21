/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};

    F.InstallView = F.View.extend({
        initialize: function(options) {
            this.deviceName = options.deviceName;
            this.accountManager = options.accountManager;
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.clearQR();
            this.selectStep('start');
            this.$syncProgress = this.$('.ui.progress');
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
            var parsed = libphonenumber.parse(number);
            if (!libphonenumber.isValidNumber(parsed)) {
                throw new Error('Invalid number ' + number);
            }
            this.selectStep('sync');
            return this.deviceName;
        },

        onProgress: function(i) {
            this.$syncProgress.progress({percent: i});
        },

        onDone: function() {
            console.info("Registraion Done (nearly)");
            this.selectStep('finish', true);
            /* This callback fires prematurely.  The storage system
             * is asyncronous.  Insert terrible timing hack to let it
             * settle. */
            console.warn("Registration async without trackability.");
            console.warn("Performing Timing HACK");
            setTimeout(() => window.location.replace(F.urls.main), 5000);
        },

        selectStep: function(id, completed) {
            const panel = this.$(`.panel[data-step="${id}"]`);
            panel.siblings().removeClass('active');
            panel.addClass('active');
            const step = this.$(`.step[data-step="${id}"]`);
            step.siblings().removeClass('active');
            step.prevAll().addClass('completed');
            step.nextAll().removeClass('completed');
            step.nextAll().addClass('disabled');
            step.addClass('active');
            if (completed) {
                step.addClass('completed');
            }
        },

        showTooManyDevices: function() {
            $('#f-too-many-devices').modal('show');
        },

        showConnectionError: function() {
            $('#f-connection-error').modal('show');
        },

        registerDevice: async function(use_sms) {
            if (!use_sms) {
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
                }
                window.addEventListener('textsecure:contactsync', this.onDone.bind(this));
                this.selectStep('sync');
            } else {
                console.error("XXX implement registerprimary device thingy");
                var number = phoneView.validateNumber();
                var verificationCode = $('#code').val().replace(/\D+/g, "");

                this.accountManager.registerSingleDevice(number, verificationCode);
                window.addEventListener('registration_done', function() {
                    console.info("Registration Done (nearly)");
                    /* This callback fires prematurely.  The storage system
                     * is asyncronous.  Insert terrible timing hack to let it
                     * settle.
                     */
                    console.warn("Registration async without trackability.");
                    console.warn("Performing Timing HACK");
                    setTimeout(() => window.location.replace(F.urls.main), 2000);
                });
            }
        }
    });
})();
