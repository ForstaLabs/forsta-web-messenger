/*global $, Whisper, Backbone, textsecure, extension*/
/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.onerror = function(message, script, line, col, error) {
        console.log("Trapping!?");
        throw(error);
    };

    var view;

    function render() {
        if (!Whisper.Registration.isDone()) {
            console.warn("Not registered, redirecting...");
            //window.open('/register.html', '_self');
            //return?
        }
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
    }

    window.addEventListener('onreload', render);
    render();
}());
