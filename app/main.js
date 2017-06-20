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

        if (forsta_env.SENTRY_DSN) {
            Raven.config(forsta_env.SENTRY_DSN, {
                release: forsta_env.GIT_COMMIT,
                serverName: forsta_env.SERVER_HOSTNAME,
                environment: 'dev'
            }).install();
        }

        F.emoji = new EmojiConvertor();
        F.emoji.include_title = true;
        F.emoji.img_sets.google.path = 'static/images/emoji/img-google-136/';
        F.emoji.img_set = 'google';

        F.router = new F.Router();

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

        F.mainView = new F.MainView();
        await F.mainView.render();

        const haveRoute = Backbone.history.start({
            pushState: true
        });
        if (!haveRoute) {
            console.warn("No route present, opening last used convo");
            F.mainView.openMostRecentConversation();
        }

        /* Ensure background ServiceWorker is installed and running. */
        const gcmService = new F.BackgroundNotificationService();
        await gcmService.start();
    }

    $(document).ready(() => main());
}());
