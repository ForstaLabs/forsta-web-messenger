// vim: ts=4:sw=4:expandtab
/* global platform */

(function() {
    'use strict';

    F.util.start_error_reporting();

    async function main() {
        await F.ccsm.login();
        await textsecure.init(new F.TextSecureStore());
        let deviceName = await F.state.get('name');
        if (!deviceName) {
            const machine = platform.product || platform.os.family;
            deviceName = `${platform.name} on ${machine} (${location.host})`;
        }
        await F.tpl.loadPartials();
        F.installView = new F.InstallView({
            el: $('body'),
            deviceName,
            accountManager: await F.foundation.getAccountManager(),
            registered: await F.state.get('registered')
        });
        const headerView = new F.HeaderView({
            el: '#f-header-view',
            model: F.currentUser
        });
        await Promise.all([
            headerView.render().then(view => view.$('.f-toggle-nav').hide()),
            F.installView.render()
        ]);
        await F.installView.registerDevice();
    }

    addEventListener('load', main);
})();
