/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.User = F.CCSMModel.extend({
        urn: '/v1/user/'
    });

    F.UsersCollection = F.CCSMCollection.extend({
        model: F.User,
        urn: '/v1/user/'
    });

    F.users = new F.UsersCollection();
})();
