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

    await ConversationController.fetchConversations();
    const inbox = getInboxCollection();

    const onNavClick = async function(event) {
        const table = event.data;
        const row = event.currentTarget;
        table.find('tr').removeClass('active');
        $(event.currentTarget).addClass('active');
        console.log(inbox);
        const convo = inbox.get(row.dataset.cid);
        console.dir(convo);
        await Forsta.tpl.render('forsta-article-feed', convo)
    };

    await Promise.all([
        Forsta.tpl.render('forsta-header-menu', {}),
        Forsta.tpl.render('forsta-nav-conversations', inbox.models.map(x => ({
            cid: x.cid,
            title: x.getTitle(),
            unreadCount: x.attributes.unreadCount,
            avatar: x.getAvatar(),
            lastMessage: x.get('lastMessage')
        }))).then(table => {
            table.on('click', 'tr', table, onNavClick);
        }),
        Forsta.tpl.render('forsta-nav-pinned', {}),
        Forsta.tpl.render('forsta-nav-announcements', {}),
        Forsta.tpl.render('forsta-article-org', {}),
        Forsta.tpl.render('forsta-article-compose', {}),
        Forsta.tpl.render('forsta-article-feed', {})
    ]);

    $('.ui.dropdown').dropdown();

    $('a.toggle-nav-vis').on('click', ev => {
        const nav = $('nav');
        const app_toggle = $('article a.toggle-nav-vis');
        if (nav.width()) {
            app_toggle.fadeIn();
            nav.width(0);
        } else {
            app_toggle.fadeOut();
            nav.width(350); // XXX
        }
    });

    $('nav table thead').on('click', ev => {
      const el = $(ev.currentTarget);
      const body = el.next('tbody');
      body.toggle();
    });
}());
