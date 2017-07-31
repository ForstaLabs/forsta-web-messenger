// vim: ts=4:sw=4:expandtab
/* global EmojiConvertor */

(function() {
    'use strict';

    F.util.start_error_reporting();

    async function loadFoundation() {
        if (!(await F.state.get('registered'))) {
            console.error("Not Registered");
            location.assign(F.urls.install);
        }
        await F.foundation.initApp();
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

        F.modalMode = !!location.search.match(/modalMode/);

        F.emoji = new EmojiConvertor();
        F.emoji.include_title = true;
        F.emoji.img_sets.google.path = F.urls.static + 'images/emoji/img-google-136/';
        F.emoji.img_set = 'google';

        F.currentUser = await F.ccsm.login();

        await Promise.all([
            loadFoundation(),
            loadTemplatePartials()
        ]);

        F.mainView = new F.MainView();
        await F.mainView.render();

        const haveRoute = F.router.start();
        if (!haveRoute) {
            F.mainView.openMostRecentConversation();
        }
    }

    addEventListener('load', main);
}());
