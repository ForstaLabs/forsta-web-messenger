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

    (async function() {
        try {
            var c = await F.users.fetch();
        } catch(e) {
            debugger;
        }
        const m = new F.User({id: 111});
        const m2 = new F.User({id: '222'});
        try {
            debugger;
            await m.fetch();
        } catch(e) {
            debugger;
        }
        try {
            await m2.fetch();
        } catch(e) {
            debugger;
        }
        debugger;
        debugger;
    });

})();
