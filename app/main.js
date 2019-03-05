// vim: ts=4:sw=4:expandtab
/* global relay */

(function() {
    'use strict';

    let $loadingDimmer;
    let $loadingProgress;
    const progressSteps = 3;
    const sessionId = F.util.uuid4();

    let _lastTick;
    function loadingTick(titleChange, amount) {
        if (_lastTick) {
            const lastTitle = $loadingDimmer.find('.loader.text').text();
            console.warn(`"${lastTitle}" took: ${Date.now() - _lastTick}ms`);
        }
        _lastTick = Date.now();
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

    async function onSharedWorkerMessage(ev) {
        /* Our shared worker lets us detect duplicate sessions by pinging any listeners
         * on startup.   We assume that anyone pinging us is a newer session and suspend
         * our session out of respect for the newer tab. */
        if (ev.data.sessionId === sessionId) {
            return;
        }
        // Not us and newer than us, time to RIP...
        console.warn("Suspending this session due to external activity");
        F.sharedWorker.port.removeEventListener('message', onSharedWorkerMessage);
        stopServices();
        await F.util.confirmModal({
            header: 'Session Suspended',
            icon: 'pause circle',
            content: 'Another tab was opened on this computer.',
            footer: 'Only one session per browser can be active to avoid ' +
                    'consistency problems.',
            confirmLabel: 'Restart this session',
            confirmIcon: 'refresh',
            dismiss: false,
            closable: false
        });
        location.reload();
        await relay.util.never();
    }

    function loadWorkers() {
        if ('serviceWorker' in navigator) {
            F.serviceWorkerManager = new F.ServiceWorkerManager();
            F.serviceWorkerManager.start(); // bg okay
        }
        if (self.SharedWorker) {
            F.sharedWorker = new SharedWorker(F.urls.worker_shared);
            F.sharedWorker.port.start();
            F.sharedWorker.port.addEventListener('message', onSharedWorkerMessage);
            F.sharedWorker.port.postMessage({sessionId});
        }
    }

    async function loadFoundation() {
        const registered = await F.state.get('registered');
        if (!registered) {
            const devices = await F.atlas.getDevices();
            const provisionView = new F.ProvisionView({devices});
            await provisionView.show();
            await provisionView.finished;
        }
        await F.foundation.initApp();
    }

    async function checkPreMessages() {
        const preMessageSenders = await F.state.get('instigators');
        if (preMessageSenders && preMessageSenders.length) {
            for (const contact of await F.atlas.getContacts(preMessageSenders)) {
                if (!contact) {
                    console.error("Skiping invalid pre message sender");
                    continue;
                }
                console.warn("Sending pre-message check to:", contact.getTagSlug());
                const t = new F.Thread({
                    id: F.util.uuid4(),
                    distribution: contact.getTagSlug()
                }, {deferSetup: true});
                await t.sendControl({control: 'preMessageCheck'});
            }
            await F.state.put('instigators', null);
        }
    }

    async function checkInterruptedCalls() {
        const activeCalls = F.foundation.allThreads.filter(m => m.get('callJoined'));
        await Promise.all(activeCalls.map(x => x.save({callJoined: false})));
        activeCalls.sort((a, b) => a.get('callActive') < b.get('callActive') ? 1 : -1);
        const mostRecent = activeCalls[0];
        if (mostRecent && mostRecent.get('callActive') > Date.now() - 300000) {
            const rejoin = await F.util.confirmModal({
                header: 'Rejoin interrupted call?',
                content: `Would you like to rejoin your call with:
                          ${mostRecent.getNormalizedTitle()}?`
            });
            const callMgr = F.calling.getOrCreateManager(mostRecent.id, mostRecent);
            if (rejoin) {
                // XXX Fix modal dimmer handling (e.g. make call view not a modal
                relay.util.sleep(1).then(() => callMgr.start({autoJoin: true}));
            } else {
                await callMgr.sendLeave();
            }
        }
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

    async function initTheme() {
        F.util.chooseTheme(await F.state.get('theme', 'default'));
    }

    const preloaded = (async () => {
        await F.cache.startSharedCache();
    })();

    async function main() {
        await preloaded;
        console.info('%cStarting Forsta Messenger',
                     'font-size: 120%; font-weight: bold;');

        $loadingDimmer = $('.f-loading.ui.dimmer');
        $loadingProgress = $loadingDimmer.find('.ui.progress');
        $loadingProgress.progress({total: progressSteps});

        loadingTick('Checking authentication...');
        await F.atlas.login();

        await Promise.all([
            F.util.startIssueReporting(),
            F.util.startUsageReporting(),
            F.tpl.loadPartials(),
            loadFoundation(),
            initTheme(),
        ]);
        loadWorkers();

        loadingTick('Loading conversations...');
        F.mainView = new F.MainView();
        await F.mainView.render();
        loadingTick();

        $loadingDimmer.removeClass('active');

        // Regression check of progress bar ticks.   The numbers need to managed manually.
        const pval = $loadingProgress.progress('get value');
        if (pval / progressSteps < 0.90) {
            console.warn("Progress bar never reached 90%", pval);
        }

        const haveRoute = F.router.start();
        if (!haveRoute && !F.util.isSmallScreen()) {
            await F.mainView.openMostRecentThread();
        } else {
            await F.mainView.openedThread;
        }

        console.info(`Messenger load time: ${Math.round(performance.now())}ms`);

        const msgRecv = F.foundation.getMessageReceiver();
        await msgRecv.idle;  // Let things cool out..
        console.info('Message receiver reached idle state.');

        await checkPreMessages();
        await checkInterruptedCalls();

        const lastSync = (await F.state.get('lastSync')) || 0;
        if (lastSync < Date.now() - (86400 * 5 * 1000)) {
            await F.util.syncContentHistory({silent: lastSync !== 0});
            (new F.sync.Request()).syncDeviceInfo();
        }
        relay.util.sleep(86400 * Math.random()).then(() => (new F.sync.Request()).syncDeviceInfo());
    }

    addEventListener('dbversionchange', onDBVersionChange);
    addEventListener('dbblocked', onDBBlocked);
    addEventListener('load', main);
}());
