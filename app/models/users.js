/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.User = F.CCSMModel.extend({
    });

    F.UsersCollection = Backbone.Collection.extend({
        model: F.User,
    });

})();
