/*
 * vim: ts=4:sw=4:expandtab
 */
(async function () {
    'use strict';

    await storage.ready();
    if (Whisper.Registration.isDone()) {
        console.info("Loading foundation...");
        initFoundation();
    } else {
        console.warn("No registration found");
        window.location.replace('install');
    }

    await ConversationController.updateInbox();
    await Promise.all([
        Forsta.tpl.render('forsta-header-menu', {}),
        Forsta.tpl.render('forsta-nav-conversations', {}),
        Forsta.tpl.render('forsta-nav-pinned', {}),
        Forsta.tpl.render('forsta-nav-announcements', {}),
        Forsta.tpl.render('forsta-article-ident', {}),
        Forsta.tpl.render('forsta-article-compose', {})
    ]);
    const view = new Forsta.MainView();
    window.openConversation = function(conversation) {
        if (conversation) {
            view.openConversation(null, conversation);
        }
    };
    openConversation(getOpenConversation());

    $('.ui.dropdown').dropdown();

    $('a.toggle-nav-vis').on('click', ev => {
        const nav = $('#forsta-app nav');
        const app_toggle = $('#forsta-app article a.toggle-nav-vis');
        if (nav.width()) {
            app_toggle.fadeIn();
            nav.width(0);
        } else {
            app_toggle.fadeOut();
            nav.width(300);
        }
    });

    $('#forsta-app > nav table thead').on('click', ev => {
      const el = $(ev.currentTarget);
      const body = el.next('tbody');
      body.toggle();
    });

}());
