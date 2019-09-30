// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function() {
    'use strict';

    let $loadingDimmer;
    let $loadingProgress;
    const progressSteps = 3;

    const logger = F.log.getLogger('main');

    let _lastTick;
    function loadingTick(titleChange, amount) {
        if (_lastTick) {
            const lastTitle = $loadingDimmer.find('.loader.text').text();
            logger.debug(`"${lastTitle}" took: ${Date.now() - _lastTick}ms`);
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
            logger.warn("Loading progress ceiling is lower than:", pval + amount);
        }
        $loadingProgress.progress('increment', amount);
    }

    async function loadFoundation() {
        const firstInit = !(await F.state.get('registered'));
        if (firstInit) {
            await F.foundation.initRelay();
            if (F.currentUser.get('user_type') === 'EPHEMERAL') {
                // Always reset account for unregistered ephemeral users.
                const am = await F.foundation.getAccountManager();
                // Reduce the time spent generating prekeys we'll likely never need.
                am.preKeyLowWater = 5;
                am.preKeyHighWater = 15;
                await am.registerAccount(F.foundation.generateDeviceName());
            } else {
                if (F.parentRPC) {
                    F.parentRPC.triggerEvent('provisioningrequired');
                }
                try {
                    const devices = await F.atlas.getDevices();
                    const provisionView = new F.ProvisionView({devices});
                    await provisionView.show();
                    await provisionView.finished;
                } catch(e) {
                    if (F.parentRPC) {
                        F.parentRPC.triggerEvent('provisioningerror', e);
                    }
                    throw e;
                }
                if (F.parentRPC) {
                    F.parentRPC.triggerEvent('provisioningdone');
                }
            }
        }
        await F.foundation.initApp({firstInit});
    }

    async function checkPreMessages() {
        // DEPRECATED
        const preMessageSenders = await F.state.get('instigators');
        if (preMessageSenders && preMessageSenders.length) {
            for (const contact of await F.atlas.getContacts(preMessageSenders)) {
                if (!contact) {
                    logger.error("Skiping invalid pre message sender");
                    continue;
                }
                logger.warn("Sending pre-message check to:", contact.getTagSlug());
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
        const recent = Date.now() - 300000;
        const recentlyJoined = F.foundation.allThreads.filter(m => m.get('inCall') > recent);
        await Promise.all(recentlyJoined.map(x => x.save({inCall: false})));  // Don't ask again.
        recentlyJoined.sort((a, b) => a.get('callActive') < b.get('callActive') ? 1 : -1);
        for (const t of recentlyJoined) {
            if (t.get('callActive') > recent) {
                const callMgr = F.calling.getOrCreateManager(t.id, t);
                if (callMgr.starting) {
                    logger.warn("Skipping rejoin-call-prompt for already active call:", t.id);
                    continue;  // already rejoined
                }
                const rejoin = await F.util.confirmModal({
                    header: 'Rejoin interrupted call?',
                    size: 'tiny',
                    content: `Would you like to rejoin your call with:
                              ${t.getNormalizedTitle()}?`,
                    confirmLabel: 'Rejoin',
                    confirmClass: 'green',
                });
                if (rejoin) {
                    await callMgr.start({autoJoin: true});
                } else {
                    // Check the starting state one last time as the user may have been called
                    // during our prompt, which supersedes this check.
                    if (callMgr.starting) {
                        logger.warn("Skipping send-leave for call activated via other means:", t.id);
                    } else {
                        logger.warn("Sending cleanup call-leave control:", t.id);
                        await callMgr.sendLeave();
                    }
                }
            }
        }
    }

    async function initTheme() {
        F.util.chooseTheme(await F.state.get('theme', 'default'));
        const orgStylesheet = (await F.currentUser.getOrg()).get('custom_css');
        if (orgStylesheet) {
            $('<style type="text/css">').text(orgStylesheet).appendTo('head');
        }
    }

    const preloaded = (async () => {
        const urlQuery = new URLSearchParams(location.search);
        const managed = urlQuery.has('managed');
        if (self !== self.parent) {
            await F.initRPC({managed});
        } else if (managed) {
            console.error('managed mode does not work when not loaded into an iframe');
        }
        await F.util.validateBrowser({skipStorage: managed});
        await Backbone.initDatabase(F.SharedCacheDatabase);
    })();

    async function main() {
        await preloaded;
        logger.info(`<large><b><sans>Starting Forsta Messenger:</sans></b> v${F.version}</large>`);

        $loadingDimmer = $('.f-loading.ui.dimmer');
        $loadingProgress = $loadingDimmer.find('.ui.progress');
        $loadingProgress.progress({total: progressSteps});

        loadingTick('Checking authentication...');
        if (F.managedConfig) {
            await F.atlas.managedLogin();
        } else {
            await F.atlas.login();
        }

        await Promise.all([
            F.util.startIssueReporting(),
            F.util.startUsageReporting(),
            F.tpl.loadPartials(),
            loadFoundation(),
            initTheme(),
        ]);

        if ('serviceWorker' in navigator && !F.managedConfig) {
            F.serviceWorkerManager = new F.ServiceWorkerManager();
            F.serviceWorkerManager.start(); // bg okay
        }

        loadingTick('Loading conversations...');
        F.mainView = new F.MainView();
        await F.mainView.render();
        loadingTick();

        $loadingDimmer.removeClass('active');

        // Regression check of progress bar ticks.   The numbers need to managed manually.
        const pval = $loadingProgress.progress('get value');
        if (pval / progressSteps < 0.90) {
            logger.warn("Progress bar never reached 90%", pval);
        }

        const disableRouterLoadUrl = F.managedConfig && F.managedConfig.openThreadId !== undefined;
        // The silent arg for router.start actually controls a deeper call to History.loadUrl();
        const haveRoute = F.router.start({silent: disableRouterLoadUrl});
        if (haveRoute) {
            await F.mainView.openedThread;
        } else if (F.managedConfig && F.managedConfig.openThreadId) {
            // managed open-thread-id is a real value..
            await F.mainView.openThreadById(F.managedConfig.openThreadId);
        } else if (F.managedConfig && F.managedConfig.openThreadId !== undefined) {
            // managed open-thread-id is defined but falsy; force default thread open..
            await F.mainView.openDefaultThread();
        } else {
            await F.mainView.openMostRecentThread();
        }

        logger.info(`Messenger load time: ${Math.round(performance.now())}ms`);
        if (F.parentRPC) {
            F.parentRPC.triggerEvent('loaded');
        }

        const msgRecv = F.foundation.getMessageReceiver();
        await msgRecv.idle;  // Let things cool out..
        logger.info('Message receiver reached idle state.');

        await checkPreMessages();
        await checkInterruptedCalls();

        const lastSync = (await F.state.get('lastSync')) || 0;
        if (lastSync < Date.now() - (86400 * 5 * 1000)) {
            await F.util.syncContentHistory({silent: lastSync !== 0});
            (new F.sync.Request()).syncDeviceInfo();
        }
        F.sleep(86400 * Math.random()).then(() => (new F.sync.Request()).syncDeviceInfo());
    }

    addEventListener('load', main);
}());
