/*
 * vim: ts=4:sw=4:expandtab
 */
;(function() {
    'use strict';
    $(function() {
        var deviceName = window.textsecure.storage.user.getDeviceName();
        if (!deviceName) {
            deviceName = 'Web Browser';
            if (navigator.userAgent.match('Mac OS')) {
                deviceName += ' on Mac';
            } else if (navigator.userAgent.match('Linux')) {
                deviceName += ' on Linux';
            } else if (navigator.userAgent.match('Windows')) {
                deviceName += ' on Windows';
            }
        }
        var view = new Whisper.InstallView({
            el: $('#install'),
            deviceName: deviceName
        });
        if (window.Whisper.Registration.everDone()) {
            view.selectStep(3);
        }
        view.$el.show();
        var accountManager = new window.getAccountManager();

        var init = function() {
            view.clearQR();

            accountManager.registerSecondDevice(
                view.setProvisioningUrl.bind(view),
                view.confirmNumber.bind(view),
                view.incrementCounter.bind(view)
            ).then(function() {
                var launch = function() {
                    window.openInbox();
                    window.removeEventListener('textsecure:contactsync', launch);
                    window.close();
                };
                window.addEventListener('textsecure:contactsync', launch);
                view.showSync();
            }).catch(function(e) {
                if (e.message === 'websocket closed') {
                    view.showConnectionError();
                    setTimeout(init, 10000);
                } else if (e.name === 'HTTPError' && e.code == 411) {
                    view.showTooManyDevices();
                }
                else {
                    throw e;
                }
            });
        };
        $('.error-dialog .ok').click(init);
        init();
    });
})();
