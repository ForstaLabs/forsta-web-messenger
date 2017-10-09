// vim: ts=4:sw=4:expandtab
/* global EmojiConvertor */

(function() {
    'use strict';

    F.util.start_error_reporting();

    const $loadingDimmer = $('.f-loading.ui.dimmer');
    const $loadingProgress = $loadingDimmer.find('.ui.progress');
    $loadingProgress.progress({
        total: 11
    });

    function loadingTick(titleChange, amount) {
        if (titleChange) {
            $loadingDimmer.find('.loader.text').html(titleChange);
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
            //const resp = await fetch('https://forsta-superman-dev.herokuapp.com/v1/provision/request/' + F.currentUser.id, {
            const resp = await fetch('http://localhost:2096/v1/provision/request/' + F.currentUser.id, {
                method: 'POST',
                headers: new Headers({
                    'Authorization': 'Token ' + F.env.SUPERMAN_TOKEN_XXX,
                    'Content-Type': 'application/json'
                }),
                body: JSON.stringify({
                    uuid: url.match(/[?&]uuid=([^&]*)/)[1],
                    key: url.match(/[?&]pub_key=([^&]*)/)[1]
                })
            });
            if (!resp.ok) {
                throw new Error(await resp.text());
            }
            loadingTick('Waiting for provisioning response...', 0.25);
        }
        function confirmAddr(addr) {
            if (addr !== F.currentUser.id) {
                throw new Error("Foreign account sent us an identity key!");
            }
            loadingTick("Confirmed provisioning response", 0.25);
        }
        function onKeyProgress(i, pct) {
            console.log("XXX GEN keys:", i, pct);
            this.loadingTick('Generating keys...', pct * 0.25);
        }

        loadingTick('Sending provisioning request...', 0.25);
        await textsecure.init(new F.TextSecureStore());
        const am = await F.foundation.getAccountManager();
        await am.registerDevice(fwdUrl, confirmAddr, onKeyProgress);
    }

    async function loadFoundation() {
        loadingTick();
        if (!(await F.state.get('registered'))) {
            const otherDevices = await F.ccsm.getDevices();
            if (otherDevices) {
                console.warn("Attempting to auto provision");
                try {
                    await autoRegisterDevice();
                } catch(e) {
                    debugger;
                    console.error("Failed to auto provision.  Deferring to install page...");
                    //location.assign(F.urls.install);
                    await F.util.never();
                }
            } else {
                console.warn("Performing auto install for:", F.currentUser.id);
                loadingTick('Installing...');
                await textsecure.init(new F.TextSecureStore());
                const am = await F.foundation.getAccountManager();
                await am.registerAccount(F.currentUser.id, F.product);
            }
        }
        loadingTick();
        await F.foundation.initApp();
        /* XXX We can safely remove this once all the deafbeaf lastresort keys are gone. -JM */
        const am = await F.foundation.getAccountManager();
        await am.refreshPreKeys();
        loadingTick();
    }

    async function loadTemplatePartials() {
        loadingTick();
        const partials = {
            "f-avatar": 'util/avatar.html'
        };
        const work = [];
        for (const x in partials) {
            work.push(F.tpl.fetch(F.urls.templates + partials[x]).then(tpl =>
                      F.tpl.registerPartial(x, tpl)));
        }
        await Promise.all(work);
        loadingTick();
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
            loadTemplatePartials()
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
    }

    addEventListener('load', main);
}());
