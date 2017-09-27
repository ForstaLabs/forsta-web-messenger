// vim: ts=4:sw=4:expandtab
/* global EmojiConvertor */

(function() {
    'use strict';

    F.util.start_error_reporting();

    async function loadServiceWorker() {
        if ('serviceWorker' in navigator) {
            F.serviceWorkerManager = new F.ServiceWorkerManager();
            await F.serviceWorkerManager.start();
        }
    }

    async function loadFoundation() {
        if (!(await F.state.get('registered'))) {
            const otherDevices = await F.ccsm.getDevices();
            if (otherDevices) {
                console.error("Not Registered - Other devices present");
                location.assign(F.urls.install);
                return;
            } else {
                console.warn("Performing auto install for:", F.currentUser.id);
                await textsecure.init(new F.TextSecureStore());
                const am = await F.foundation.getAccountManager();
                await am.registerAccount(F.currentUser.id, F.product);
            }
        }
        await F.foundation.initApp();
        /* XXX We can safely remove this once all the deafbeaf lastresort keys are gone. -JM */
        const am = await F.foundation.getAccountManager();
        await am.refreshPreKeys();
    }

    async function loadTemplatePartials() {
        const partials = {
            "f-avatar": 'util/avatar.html'
        };
        const work = [];
        for (const x in partials) {
            work.push(F.tpl.fetch(F.urls.templates + partials[x]).then(tpl =>
                      F.tpl.registerPartial(x, tpl)));
        }
        await Promise.all(work);
    }

    async function main() {
        console.log('%cStarting Forsta Messenger',
                    'font-size: 120%; font-weight: bold;');

        F.emoji = new EmojiConvertor();
        F.emoji.include_title = true;
        F.emoji.img_sets.google.path = F.urls.static + 'images/emoji/img-google-136/';
        F.emoji.img_set = 'google';

        await F.ccsm.login();
        await F.cache.validate();

        await Promise.all([
            loadServiceWorker(),
            loadFoundation(),
            loadTemplatePartials()
        ]);

        F.mainView = new F.MainView();
        await F.mainView.render();

        const haveRoute = F.router.start();
        if (!haveRoute) {
            F.mainView.openMostRecentThread();
        }
    }

    addEventListener('load', main);
}());
