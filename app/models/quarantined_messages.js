// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function() {
    'use strict';

    self.F = self.F || {};

    F.QuarantinedMessage = Backbone.Model.extend({
        database: F.Database,
        storeName: 'quarantinedMessages'
    });

    F.QuarantinedMessageCollection = Backbone.Collection.extend({
        model: F.QuarantinedMessage,
        database: F.Database,
        storeName: 'quarantinedMessages',

        comparator: function(a, b) {
            return a.get('timestamp') - b.get('timestamp');
        }
    });
})();
