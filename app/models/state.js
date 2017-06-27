/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.State = Backbone.Model.extend({
        database: F.Database,
        storeName: 'state',
        idAttribute: 'key'
    });

    F.StateCollection = Backbone.Collection.extend({
        model: F.State,
        database: F.Database,
        storeName: 'state',

        destroyAll: async function () {
            await Promise.all(this.models.map(m => m.destroy()));
        }
    });
})();
