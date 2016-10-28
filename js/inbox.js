/*global $, Whisper, Backbone, textsecure, extension*/
/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    var view;

    storage.onready(function() {
        if (Whisper.Registration.isDone()) {
            console.info("Registered! Doing init...");
            initFoundation();
        } else {
            throw "what are you doing here?";
            // or ..
            // console.warn("Not registered, redirecting...");
            // window.open('/register.html', '_self');
        }
    });

    ConversationController.updateInbox().then(function() {
        if (view) { view.remove(); }
        var $body = $('body', document).empty();
        view = new Whisper.InboxView({window: window});
        view.$el.prependTo($body);
        window.openConversation = function(conversation) {
            if (conversation) {
                view.openConversation(null, conversation);
            }
        };
        openConversation(getOpenConversation());
    });
}());
