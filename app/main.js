// vim: ts=4:sw=4:expandtab
/* global EmojiConvertor relay */

(function() {
    'use strict';

    F.util.startIssueReporting();

    const $loadingDimmer = $('.f-loading.ui.dimmer');
    const progressSteps = 5;
    const $loadingProgress = $loadingDimmer.find('.ui.progress');
    $loadingProgress.progress({total: progressSteps});

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

    function loadWorkers() {
        if ('serviceWorker' in navigator) {
            F.serviceWorkerManager = new F.ServiceWorkerManager();
            F.serviceWorkerManager.start(); // bg okay
        }
        if (self.SharedWorker) {
            F.sharedWorker = new SharedWorker('/@worker-shared.js');
            F.sharedWorker.port.start();
            const id = F.util.uuid4();
            F.sharedWorker.port.addEventListener('message', async function(ev) {
                const msg = ev.data;
                if (msg.id !== id) {
                    console.warn("Suspending this session due to external activity");
                    F.foundation.getMessageReceiver().close();
                    if (await F.util.confirmModal({
                        header: 'Session Suspended',
                        icon: 'pause circle',
                        content: 'Another tab was opened on this computer.',
                        footer: 'Only one session per browser can be active at the same time.',
                        confirmLabel: 'Resume this session',
                        confirmIcon: 'play circle',
                        cancel: false,
                        closable: false
                    })) {
                        location.reload();
                    } else {
                        close();
                    }
                }
            });
            F.sharedWorker.port.postMessage({id});
        }
    }

    async function loadFoundation() {
        if (!(await F.state.get('registered'))) {
            const otherDevices = await F.atlas.getDevices();
            if (otherDevices) {
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

    async function main() {
        console.log('%cStarting Forsta Messenger',
                    'font-size: 120%; font-weight: bold;');

        F.emoji = new EmojiConvertor();
        F.emoji.include_title = true;
        F.emoji.img_sets.google.path = F.urls.static + 'images/emoji/img-google-136/';
        F.emoji.img_set = 'google';

        loadingTick('Checking authentication...');
        await F.atlas.login();
        await F.cache.validate();

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
        if (!haveRoute) {
            await F.mainView.openMostRecentThread();
        }
        $loadingDimmer.removeClass('active');

        const pval = $loadingProgress.progress('get value');
        if (pval / progressSteps < 0.90) {
            console.warn("Progress bar never reached 90%", pval);
        }
    }

    addEventListener('load', main);
}());
