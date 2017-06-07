/*
 * vim: ts=4:sw=4:expandtab
 */
(async function() {
    'use strict';

    async function startup() {
        await Promise.all([storage.ready(), F.tpl.fetchAll()]);
        if (Whisper.Registration.isDone()) {
            console.info("Loading foundation...");
            initFoundation();
        } else {
            console.warn("No registration found");
            window.location.replace('install');
        }
        await Whisper.getConversations().fetchActive();
        window.mainView = new F.MainView();
    }

    $(document).ready(() => startup());
}());
