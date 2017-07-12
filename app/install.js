// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    F.util.start_error_reporting();

    async function main() {
        await textsecure.init(new F.TextSecureStore());
        let deviceName = await F.state.get('deviceName');
        if (!deviceName) {
            const machine = platform.product || platform.os.family;
            deviceName = `${platform.name} on ${machine} (${location.host})`;
        }
        const view = new F.InstallView({
            el: $('body'),
            deviceName,
            accountManager: await F.foundation.getAccountManager(),
            registered: await F.state.get('registered')
        });
        await view.render();
        view.registerDevice();
    }

    addEventListener('load', main);
})();
