// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function() {
    'use strict';

    self.F = self.F || {};

    F.QuarantinedMessage = Backbone.Model.extend({
        database: F.Database,
        storeName: 'quarantinedMessages'
    });

    F.TrustedIdentityCollection = Backbone.Collection.extend({
        model: F.QuarantinedMessage,
        database: F.Database,
        storeName: 'quarantinedMessages'
    });
})();
