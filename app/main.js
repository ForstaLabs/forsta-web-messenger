// vim: ts=4:sw=4:expandtab
/* global EmojiConvertor, platform */

(function() {
    'use strict';

    F.util.start_error_reporting();

    const $loadingDimmer = $('.f-loading.ui.dimmer');
    const progressSteps = 6;
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

    function loadServiceWorker() {
        if ('serviceWorker' in navigator) {
            F.serviceWorkerManager = new F.ServiceWorkerManager();
            F.serviceWorkerManager.start(); // bg okay
        }
    }

    async function autoRegisterDevice() {
        async function fwdUrl(url) {
            loadingTick('Sending provisioning request...', 0.33);
            url = decodeURIComponent(url);
            await F.ccsm.fetchResource('/v1/provision/request', {
                method: 'POST',
                json: {
                    uuid: url.match(/[?&]uuid=([^&]*)/)[1],
                    key: url.match(/[?&]pub_key=([^&]*)/)[1]
                }
            });
            loadingTick('Waiting for provisioning response...', 0.33);
        }
        function confirmAddr(addr) {
            if (addr !== F.currentUser.id) {
                throw new Error("Foreign account sent us an identity key!");
            }
            const machine = platform.product || platform.os.family;
            let name = `${platform.name} on ${machine} (${location.host})`;
            if (name.length >= 50) {
                name = name.substring(0, 46) + '...';
            }
            return name;
        }
        function onKeyProgress(i, pct) {
            loadingTick(`Generating keys: ${Math.round(pct * 100)}%`, 0.0033);  // 100 ticks
        }

        await textsecure.init(new F.TextSecureStore());
        const am = await F.foundation.getAccountManager();
        const regJob =  am.registerDevice(fwdUrl, confirmAddr, onKeyProgress);
        const timeout = 20;
        const done = await Promise.race([regJob, F.util.sleep(timeout)]);
        if (done === timeout) {
            throw new Error("Timeout waiting for provisioning");
        }
    }

    async function loadFoundation() {
        if (!(await F.state.get('registered'))) {
            const otherDevices = await F.ccsm.getDevices();
            if (otherDevices) {
                loadingTick('Starting device provisioning...', 0);
                console.warn("Attempting to auto provision");
                try {
                    await autoRegisterDevice();
                } catch(e) {
                    console.error("Failed to auto provision.  Deferring to install page...", e);
                    location.assign(F.urls.install);
                    await F.util.never();
                }
            } else {
                loadingTick('Installing...', 0);
                console.warn("Performing auto install for:", F.currentUser.id);
                await textsecure.init(new F.TextSecureStore());
                const am = await F.foundation.getAccountManager();
                await am.registerAccount(F.currentUser.id, F.product);
                loadingTick();
            }
        } else {
            loadingTick();  // Compensate for missed step if provisioning not needed.
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
        await F.ccsm.login();
        await F.cache.validate();

        loadingTick('Initializing platform...');
        await Promise.all([
            loadFoundation(),
            F.tpl.loadPartials()
        ]);
        loadServiceWorker();

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
