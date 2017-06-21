/*
 * vim: ts=4:sw=4:expandtab
 */
;(function() {
    'use strict';

    const accountManager = new window.getAccountManager();

    let deviceName = window.textsecure.storage.user.getDeviceName();
    if (!deviceName) {
        const machine = platform.product || platform.os.family;
        deviceName = `${platform.name} on ${machine} (${location.host})`;
    }

    const view = new F.InstallView({
        el: $('body'),
        deviceName,
        accountManager
    });

    accountManager.addEventListener('registration', function() {
        /* XXX Suspect */
        initInstallerFoundation();
    });

    async function main() {
        if (storage.get('registered')) {
            console.warn("Already Registered: XXX What to do here?");
        }
        await view.render();
        view.registerDevice();
    };

    $(document).ready(() => main());
})();
