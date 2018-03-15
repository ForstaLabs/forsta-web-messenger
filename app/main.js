// vim: ts=4:sw=4:expandtab
/* global relay */

(function() {
    'use strict';

    let $loadingDimmer;
    let $loadingProgress;
    const progressSteps = 5;
    const sessionId = F.util.uuid4();

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
        if (!(await F.state.get('registered'))) {
            const otherDevices = await F.atlas.getDevices();
            if (otherDevices.length) {
                loadingTick('Starting device provisioning...', 0);
                console.warn("Attempting to auto provision");
                const provisioning = await F.foundation.autoProvision();
                for (let i = 15; i >= 0; i--) {
                    let done;
                    try {
                        done = await Promise.race([provisioning.done, relay.util.sleep(1)]);
                    } catch(e) {
                        console.error("Failed to auto provision.  Deferring to install page...", e);
                        location.assign(F.urls.install);
                        await relay.util.never();
                    }
                    if (!provisioning.waiting) {
                        loadingTick(`Processing provisioning response...`, 0);
                        await provisioning.done;
                        break;
                    } else if (done === 1) {
                        loadingTick(`Waiting for provisioning response: ${i} seconds remain.`, 0);
                    }
                    if (!i) {
                        console.error("Timeout waiting for provisioning response.");
                        location.assign(F.urls.install);
                        await relay.util.never();
                    }
                }
            } else {
                loadingTick('Installing...', 0);
                console.warn("Performing auto install for:", F.currentUser.id);
                const am = await F.foundation.getAccountManager();
                await am.registerAccount(F.foundation.generateDeviceName());
                loadingTick();
            }
        }
        loadingTick('Initializing application...');
        await F.foundation.initApp();
    }

    async function checkPreMessages() {
        const preMessageSenders = await F.state.get('instigators');
        if (preMessageSenders && preMessageSenders.length) {
            for (const contact of await F.atlas.getContacts(preMessageSenders)) {
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
        console.info('%cStarting Forsta Messenger',
                     'font-size: 120%; font-weight: bold;');

        $loadingDimmer = $('.f-loading.ui.dimmer');
        $loadingProgress = $loadingDimmer.find('.ui.progress');
        $loadingProgress.progress({total: progressSteps});

        loadingTick('Checking authentication...');
        await F.cache.startSharedCache();
        await F.atlas.login();
        await F.util.startIssueReporting();
        await F.util.startUsageReporting();

        loadingTick('Loading resources...');
        await Promise.all([
            loadFoundation(),
            F.tpl.loadPartials()
        ]);
        loadWorkers();

        loadingTick('Loading conversations...');
        F.mainView = new F.MainView();
        await F.mainView.render();
        loadingTick();

        const haveRoute = F.router.start();
        if (!haveRoute && !F.util.isSmallScreen()) {
            await F.mainView.openMostRecentThread();
        }
        $loadingDimmer.removeClass('active');
        console.info(`Messenger load time: ${Math.round(performance.now())}ms`);

        const pval = $loadingProgress.progress('get value');
        if (pval / progressSteps < 0.90) {
            console.warn("Progress bar never reached 90%", pval);
        }

        await checkPreMessages();
        const lastSync = (await F.state.get('lastSync')) || 0;
        if (lastSync < Date.now() - (86400 * 7 * 1000)) {
            await F.util.syncContentHistory();
        }
        relay.util.sleep(3600).then(() => (new F.sync.Request()).syncDeviceInfo());
    }

    addEventListener('dbversionchange', onDBVersionChange);
    addEventListener('dbblocked', onDBBlocked);
    addEventListener('load', main);
}());
