/*
 * vim: ts=4:sw=4:expandtab
 */
(async function() {
    'use strict';

    window.F = window.F || {};

    async function loadUser() {
        try {
            F.user_profile = await F.ccsm.getUserProfile();
        } catch(e) {
            console.warn("User load failure:", e);
            return new Error('/');
        }
        ga('set', 'userId', F.user_profile.user_id);
    }

    async function loadFoundation() {
        if (storage.get('registered')) {
            initFoundation();
        } else {
            console.warn("Not Registered");
            return new Error('install');
        }
        await F.getConversations().fetchActive();
    }

    async function loadTemplatePartials() {
        const partials = {
            "f-avatar": 'templates/util/avatar.html'
        };
        const work = [];
        for (const x in partials) {
            work.push(F.tpl.fetch(partials[x]).then(tpl =>
                      F.tpl.registerPartial(x, tpl)));
        }
        await Promise.all(work);
    }

    async function main() {
        console.log('%cStarting Forsta Messenger',
                    'font-size: 120%; font-weight: bold;');

        // XXX source this from window.forsta_env
        Raven.config('https://9b52d99a5c614a30ae4690ea57edbde3@sentry.io/179714').install()

        window.emoji = new EmojiConvertor();
        emoji.include_title = true;
        emoji.img_sets.google.path = 'static/images/emoji/img-google-136/';
        emoji.img_set = 'google';

        const errors = await Promise.all([
            loadUser(),
            loadFoundation(),
            loadTemplatePartials()
        ]);
        /* Priority sorted. */
        for (const e of errors) {
            if (e && e.message) {
                console.warn("Redirecting to:", e.message);
                location.replace(e.message);
                return;
            }
        }
        window.mainView = new F.MainView();
        await mainView.render();
    }

    $(document).ready(() => main());
}());
