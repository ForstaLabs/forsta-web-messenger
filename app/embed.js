// vim: ts=4:sw=4:expandtab
/* global relay */

(function() {
    'use strict';

    async function loadFoundation() {
        if (!(await F.state.get('registered'))) {
            const am = await F.foundation.getAccountManager();
            await am.registerAccount(F.foundation.generateDeviceName());
        }
        await F.foundation.initApp();
    }

    function stopServices() {
        const mr = F.foundation.getMessageReceiver();
        if (mr) {
            mr.close();
        }
    }

    async function onDBVersionChange() {
        stopServices();
        F.util.confirmModal({
            header: 'Database was updated in another session',
            icon: 'database',
            content: 'The database in this session is stale.<br/><br/>' +
                     '<b>Reloading in 10 seconds...</b>',
            confirm: false,
            dismiss: false,
            closable: false
        });
        await relay.util.sleep(10);
        location.reload();
        await relay.util.never();
    }

    async function onDBBlocked() {
        stopServices();
        await F.util.confirmModal({
            header: 'Database use blocked by another session',
            icon: 'database',
            content: 'The database is inaccessible due to activity in another session.  Please ' +
                     'close other tabs and/or restart your browser to resolve this condition.',
            confirmLabel: 'Reload',
            confirmIcon: 'refresh circle',
            dismiss: false,
            closable: false
        });
        location.reload();
        await relay.util.never();
    }

    const preloaded = (async () => {
        const params = new URLSearchParams(location.search);
        const theme = params.get('theme');
        if (theme) {
            F.util.chooseTheme(theme);
        }
        await F.cache.startSharedCache();
    })();

    async function main() {
        await preloaded;
        console.info('%cStarting Forsta Embedded Client',
                     'font-size: 120%; font-weight: bold;');

        const params = new URLSearchParams(location.search);
        const token = params.get('token');
        if (!token) {
            F.util.confirmModal({
                header: 'Token Required',
                icon: 'red warning sign',
                content: 'An embedded client token is required.  e.g. ' +
                         '<samp>https://app.forsta.io/@embed?token=ORG_EPHEMERAL_USER_TOKEN</samp>',
                confirm: false,
                dismiss: false,
                closable: false
            });
            return;
        }
        await F.atlas.ephemeralLogin(params);

        await Promise.all([
            F.util.startIssueReporting(),
            F.util.startUsageReporting(),
            F.tpl.loadPartials(),
            loadFoundation()
        ]);

        F.mainView = new F.EmbedView();
        await F.mainView.render();
        await F.mainView.openDefaultThread();

        $('body > .ui.dimmer').removeClass('active');
        console.info(`Messenger load time: ${Math.round(performance.now())}ms`);
    }

    addEventListener('dbversionchange', onDBVersionChange);
    addEventListener('dbblocked', onDBBlocked);
    addEventListener('load', main);
}());
