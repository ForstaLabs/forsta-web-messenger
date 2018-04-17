// vim: ts=4:sw=4:expandtab
/* global relay */

(function() {
    'use strict';

    let $loadingDimmer;
    let $loadingProgress;
    const progressSteps = 5;

    function loadingTick(titleChange, amount) {
        if (titleChange) {
            $loadingDimmer.find('.loader.text').html(titleChange);
        }
        if (amount === 0) {
            return;
        }
        const pval = $loadingProgress.progress('get value');
        if (amount + pval > progressSteps) {
            console.warn("Loading progress ceiling is lower than:", pval + amount);
        }
        $loadingProgress.progress('increment', amount);
    }

    async function loadFoundation() {
        if (!(await F.state.get('registered'))) {
            loadingTick('Installing...', 0);
            const am = await F.foundation.getAccountManager();
            await am.registerAccount(F.foundation.generateDeviceName());
            loadingTick();
        }
        loadingTick('Initializing application...');
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

    async function main() {
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

        $loadingDimmer = $('.f-loading.ui.dimmer');
        $loadingProgress = $loadingDimmer.find('.ui.progress');
        $loadingProgress.progress({total: progressSteps});

        loadingTick('Checking authentication...');
        await F.cache.startSharedCache();
        await F.atlas.ephemeralLogin(params);
        await F.util.startIssueReporting();
        await F.util.startUsageReporting();

        loadingTick('Loading resources...');
        await Promise.all([
            loadFoundation(),
            F.tpl.loadPartials()
        ]);

        loadingTick('Loading conversation...');
        F.mainView = new F.EmbedView();
        await F.mainView.render();
        loadingTick();

        const haveRoute = F.router.start(); // XXX probably never use haveRoute
        if (!haveRoute) { // XXX probably never use haveRoute
            await F.mainView.openDefaultThread(); // XXX probably never use haveRoute
        }
        $loadingDimmer.removeClass('active');
        console.info(`Messenger load time: ${Math.round(performance.now())}ms`);

        const pval = $loadingProgress.progress('get value');
        if (pval / progressSteps < 0.90) {
            console.warn("Progress bar never reached 90%", pval);
        }

        const msgRecv = F.foundation.getMessageReceiver();
        await msgRecv.idle;  // Let things cool out..
        console.info('Message receiver reached idle state.');
    }

    addEventListener('dbversionchange', onDBVersionChange);
    addEventListener('dbblocked', onDBBlocked);
    addEventListener('load', main);
}());
