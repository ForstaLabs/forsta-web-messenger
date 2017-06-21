/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';
    window.Whisper = window.Whisper || {};

    Whisper.InstallView = Whisper.View.extend({
        templateName: 'install_flow_template',
        initialize: function(options) {
            this.counter = 0;
            this.render();
            this.$('#device-name').val(options.deviceName);
            this.$('#step1').show();
        },
        events: function() {
            return {
                'click .step1': this.selectStep.bind(this, 1),
                'click .step2': this.selectStep.bind(this, 2),
                'click .step3': this.selectStep.bind(this, 3)
            };
        },
        clearQR: function() {
            this.$('#qr').text(i18n("installConnecting"));
        },
        setProvisioningUrl: function(url) {
            this.$('#qr').html('');
            new QRCode(this.$('#qr')[0]).makeCode(url);
        },
        confirmNumber: function(number) {
            var parsed = libphonenumber.parse(number);
            if (!libphonenumber.isValidNumber(parsed)) {
                throw new Error('Invalid number ' + number);
            }
            this.$('#step2 .number').text(libphonenumber.format(
                parsed,
                libphonenumber.PhoneNumberFormat.INTERNATIONAL
            ));
            this.selectStep(2);
            this.$('#device-name').focus();
            return new Promise(function(resolve, reject) {
                this.$('#finish').click(function(e) {
                    e.stopPropagation();
                    var name = this.$('#device-name').val();
                    name = name.replace(/\0/g,''); // strip unicode null
                    if (name.trim().length === 0) {
                        this.$('#device-name').focus();
                        return;
                    }
                    this.$('.progress-dialog .status').text(i18n('installGeneratingKeys'));
                    this.selectStep(3);
                    resolve(name);
                }.bind(this));
            }.bind(this));
        },
        incrementCounter: function() {
            this.$('.progress-dialog .bar').css('width', (++this.counter * 100 / 100) + '%');
        },
        selectStep: function(step) {
            this.$('.step').hide();
            this.$('#step' + step).show();
        },
        showSync: function() {
            this.$('.progress-dialog .status').text(i18n('installSyncingGroupsAndContacts'));
            this.$('.progress-dialog .bar').addClass('progress-bar-striped active');
        },
        showTooManyDevices: function() {
            this.selectStep('TooManyDevices');
        },
        showConnectionError: function() {
            this.$('#qr').text(i18n("installConnectionFailed"));
        }
    });
})();
