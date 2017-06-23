/*
 * vim: ts=4:sw=4:expandtab
 */
;(function() {
    'use strict';

    let deviceName = textsecure.storage.user.getDeviceName();
    if (!deviceName) {
        const machine = platform.product || platform.os.family;
        deviceName = `${platform.name} on ${machine} (${location.host})`;
    }

    async function main() {
        const view = new F.InstallView({
            el: $('body'),
            deviceName,
            accountManager: new F.foundation.getAccountManager(),
            registered: storage.get('registered')
        });
        await textsecure.init(new SignalProtocolStore());
        await view.render();
        view.registerDevice();
    };

    $(document).ready(() => main());
})();
