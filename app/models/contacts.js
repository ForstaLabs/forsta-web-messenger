// vim: ts=4:sw=4:expandtab
/* global Backbone */

/* Contacts are basically User models but they are kept in our local database
 * making them useful for managing users by preference and for some other 
 * cases where the user may not actually exist (invalid users, pending users,
 * etc).
 */

(function () {
    'use strict';

    self.F = self.F || {};

    F.Contact = F.User.extend({
        database: F.Database,
        storeName: 'contacts',
        sync: Backbone.Model.prototype.sync
    });

    F.ContactCollection = Backbone.Collection.extend({
        database: F.Database,
        storeName: 'contacts',
        model: F.Contact,
        sync: Backbone.Model.prototype.sync,
        parse: Backbone.Model.prototype.parse
    });
})();
