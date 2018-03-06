// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function() {
    'use strict';

    self.F = self.F || {};

    F.TrustedIdentity = Backbone.Model.extend({
        database: F.Database,
        storeName: 'trustedIdentities',

        defaults: () => ({
            created: Date.now(),
            updated: Date.now()
        })
    });

    F.TrustedIdentityCollection = Backbone.Collection.extend({
        model: F.TrustedIdentity,
        database: F.Database,
        storeName: 'trustedIdentities'
    });
})();
