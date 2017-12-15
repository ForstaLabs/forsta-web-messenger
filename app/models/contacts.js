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
        parse: Backbone.Model.prototype.parse,

        comparator: function(m1, m2) {
            const v1 = m1.get('last_name') + m1.get('first_name') + m1.get('org').slug;
            const v2 = m2.get('last_name') + m1.get('first_name') + m1.get('org').slug;
            if (v1 === v2) {
                const c1 = m1.get('useCount') || 0;
                const c2 = m2.get('useCount') || 0;
                return c1 === c2 ? 0 : c1 > c2 ? 1 : -1;
            } else {
                return v1 > v2 ? 1 : -1;
            }
        },

        refresh: async function() {
            await this.fetch();
            await F.atlas.getContacts(this.models.map(x => x.id));
        }
    });
})();
