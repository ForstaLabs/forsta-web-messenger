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

        await ConversationController.fetchConversations();

        const mainView = new F.MainView();
        if (!getOpenConversation()) {
            console.warn("XXX Please select something or show help page.");
        } else {
            mainView.openConversation(null, getOpenConversation());
        }
    }

    /*
    const onComposeSend = async function(ev) {
        const box = ev.data;
        if (!convo) {
            alert('XXX no convo');
            return;
        }
        const message = box.find('textarea').val();
        convo.sendMessage(message, []);
    }; 
    
    await Promise.all([
        F.tpl.render('f-article-compose', {}).then(ctx => {
            ctx.on('click', '.f-send', ctx, onComposeSend);
            ctx.find('textarea').focus();
        }),
    ]);
    */

    $(document).ready(() => startup());
}());
