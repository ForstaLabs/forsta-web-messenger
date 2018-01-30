// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    async function main() {
        await F.atlas.login();
        await F.util.startIssueReporting();
        await F.util.startUsageReporting();
        await F.tpl.loadPartials();
        F.installView = new F.InstallView({
            el: $('body'),
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
        await F.installView.loop();
    }

    addEventListener('load', main);
    addEventListener('dbblocked', () => location.reload());
    addEventListener('dbversionchange', () => location.reload());
})();
