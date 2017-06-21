/*
 * vim: ts=4:sw=4:expandtab
 */
(function() {
    'use strict';

    window.F = window.F || {};

    F.Router = Backbone.Router.extend({
        routes: {
            "@/:ident": 'onConversation',
        },

        onConversation: function(ident) {
            console.info("Routing to:", ident);
            F.mainView.openConversationById(ident);
        }
    });
}());
