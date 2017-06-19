/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};

    F.User = F.CCSMModel.extend({
    });

    F.UsersCollection = Backbone.Collection.extend({
        model: F.User,
    });

})();
