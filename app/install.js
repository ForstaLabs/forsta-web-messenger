/*
 * vim: ts=4:sw=4:expandtab
 */
;(function() {
    'use strict';
    $(function() {
        let deviceName = window.textsecure.storage.user.getDeviceName();
        if (!deviceName) {
            const machine = platform.product || platform.os.family;
            deviceName = `${platform.name} on ${machine} (${location.host})`;
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
        accountManager.addEventListener('registration', function() {
            initInstallerFoundation();
        });

        var init = function() {
            view.clearQR();

            accountManager.registerSecondDevice(
                view.setProvisioningUrl.bind(view),
                view.confirmNumber.bind(view),
                view.incrementCounter.bind(view)
            ).then(function() {
                var redirect = function() {
                    console.info("Registraion Done (nearly)");
                    /* This callback fires prematurely.  The storage system
                     * is asyncronous.  Insert terrible timing hack to let it
                     * settle.
                     */
                    console.warn("Registration async without trackability.");
                    console.warn("Performing Timing HACK");
                    setTimeout(() => window.location.replace('.'), 2000);
                };
                window.addEventListener('textsecure:contactsync', redirect);
                view.showSync();
            }).catch(function(e) {
                if (e.message === 'websocket closed') {
                    view.showConnectionError();
                    setTimeout(init, 10000);
                } else if (e.name === 'HTTPError' && e.code == 411) {
                    view.showTooManyDevices();
                } else {
                    throw e;
                }
            });
        };
        $('.error-dialog .ok').click(init);
        init();
    });
})();
