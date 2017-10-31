// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    F.util.startIssueReporting();

    async function main() {
        await F.ccsm.login();
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
        await F.installView.registerDevice().done;
    }

    addEventListener('load', main);
})();
