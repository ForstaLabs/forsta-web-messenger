/*global $, Whisper, Backbone, textsecure, platform */
/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};

    var body = $('body', document);
    var conversation = getConversationForWindow();
    if (conversation) {
        window.document.title = conversation.getTitle();
        var view = new bg.Whisper.ConversationView({
            model: conversation,
            appWindow: windowInfo
        });
        view.$el.prependTo(body);
        view.$('input.send-message').focus();
    } else {
        $('<div>').text('Error').prependTo(body);
    }
}());
