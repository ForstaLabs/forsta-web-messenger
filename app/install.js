// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    F.util.start_error_reporting();

    async function main() {
        try {
            F.currentUser = await F.ccsm.fetchUser();
        } catch(e) {
            console.warn("User load failure:", e);
            location.assign(F.urls.login);
            throw e;
        }
        await textsecure.init(new F.TextSecureStore());
        let deviceName = await F.state.get('deviceName');
        if (!deviceName) {
            const machine = platform.product || platform.os.family;
            deviceName = `${platform.name} on ${machine} (${location.host})`;
        }
        F.installView = new F.InstallView({
            el: $('body'),
            deviceName,
            accountManager: await F.foundation.getAccountManager(),
            registered: await F.state.get('registered')
        });
        await F.installView.render();
        F.installView.registerDevice();
    }

    addEventListener('load', main);
})();
