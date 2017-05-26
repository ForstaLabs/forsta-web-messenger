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
    let convo;

    const onNavClick = async function(event) {
        const table = event.data;
        const row = event.currentTarget;
        table.find('tr').removeClass('active');
        $(event.currentTarget).addClass('active');
        convo = inbox.get(row.dataset.cid);
        await convo.fetchContacts();
        const messages = await convo.fetchMessages();
        for (const msg of messages) {
            const contact = convo.contactCollection.get(msg.source);
            if (contact) {
                msg.avatar = contact.getAvatar();
                msg.name = contact.getName();
            } else {
                msg.name = msg.source;
                msg.avatar = {
                    content: '?'
                };
            }
            for (const x of msg.attachments) {
                const blob = new Blob([x.data], {type: x.contentType});
                x.url = URL.createObjectURL(blob);
            }
            msg.when = (Date.now() - msg.timestamp) / 1000;
        }
        await F.tpl.render('f-article-feed', messages)
    };

    const onComposeSend = async function(event) {
        const box = event.data;
        if (!convo) {
            alert('XXX no convo');
            return;
        }
        const message = box.find('textarea').val();
        convo.sendMessage(message, []);
    };

    await Promise.all([
        F.tpl.render('f-header-menu', {}),
        F.tpl.render('f-nav-conversations', inbox.models.map(x => ({
            cid: x.cid,
            title: x.getTitle(),
            unreadCount: x.attributes.unreadCount,
            avatar: x.getAvatar(),
            lastMessage: x.get('lastMessage')
        }))).then(table => {
            table.on('click', 'tr', table, onNavClick);
        }),
        F.tpl.render('f-nav-pinned', {}),
        F.tpl.render('f-nav-announcements', {}),
        F.tpl.render('f-article-org', {}),
        F.tpl.render('f-article-compose', {}).then(box => {
            box.on('click', '.f-send', box, onComposeSend);
            box.find('textarea').focus();
        }),
        F.tpl.render('f-article-feed', {})
    ]);

    $('.ui.dropdown').dropdown();
    $('.f-compose textarea').focus();

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
