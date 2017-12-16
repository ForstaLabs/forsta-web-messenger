// vim: ts=4:sw=4:expandtab
/* global Backbone relay */

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
        sync: Backbone.Model.prototype.sync,

        promoteFromPending: async function() {
            console.warn("Pending contact upgraded to real contact", x);
            this.unset('pending');
            await this.save();
            const threads = new F.ThreadCollection();
            await threads.fetchByPendingMember(this.id);
            for (const t of threads.models) {
                const pending = new Set(t.get('pendingMembers'));
                pending.delete(this.id);
                await t.save({
                    pendingMembers: Array.from(pending),
                    distribution: `${t.get('distribution')} + ${this.getTagSlug()}`
                });
                F.foundation.allThreads.get(t.id).set(t);
            }
            //const preMessages = new F.MessageCollection();
            //preMessages.fetchByMember(this.id);
            //for (const m of preMessages.models) {
            //    m.getCurrentThread().send(m);
            //    debugger;
            //}
        }
    });

    const getUsersFromCache = F.cache.ttl(900, relay.hub.getUsers);

    F.ContactCollection = Backbone.Collection.extend({
        database: F.Database,
        storeName: 'contacts',
        model: F.Contact,
        sync: Backbone.Model.prototype.sync,
        parse: Backbone.Model.prototype.parse,

        comparator: function(m1, m2) {
            const v1 = m1.get('last_name') + m1.get('first_name') + m1.get('org').slug;
            const v2 = m2.get('last_name') + m1.get('first_name') + m1.get('org').slug;
            return v1 === v2 ? 0 : v1 > v2 ? 1 : -1;
        },

        refresh: async function() {
            await this.fetch();
            let todo = new F.util.ESet(this.models.map(x => x.id));
            todo = todo.union(new Set(F.foundation.getUsers().models.map(x => x.id)));
            await Promise.all((await getUsersFromCache(Array.from(todo))).map(async x => {
                const match = this.get(x.id);
                if (match) {
                    await match.save(x);
                    if (match.get('pending')) {
                        await match.promoteFromPending();
                    }
                } else {
                    const c = new F.Contact(x);
                    await c.save();
                    this.add(c);
                    console.info("Detected new contact:", c.id, c.getTagSlug());
                }
                todo.delete(x.id);
            }));
            for (const x of todo) {
                const inactive = this.get(x);
                if (!inactive.get('pending')) {
                    console.warn("Destroying invalid contact:", inactive);
                    await inactive.destroy();
                }
            }
        }
    });
})();
