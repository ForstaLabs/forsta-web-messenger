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
    }

    async function loadFoundation() {
        await storage.ready();
        if (Whisper.Registration.isDone()) {
            initFoundation();
        } else {
            console.warn("No registration found");
            return new Error('install');
        }
        await Whisper.getConversations().fetchActive();
    }

    async function main() {
        console.log('%cStarting Forsta Messenger',
                    'font-size: 120%; font-weight: bold;');
        const errors = await Promise.all([
            loadUser(),
            loadFoundation(),
            F.tpl.fetchAll()
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
    }

    $(document).ready(() => main());
}());
