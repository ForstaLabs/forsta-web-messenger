// vim: ts=4:sw=4:expandtab
/* global tagParser */

(function () {
    'use strict';

    self.F = self.F || {};

    F.Tag = F.CCSMModel.extend({
        urn: '/v1/tag/'
    });

    F.TagCollection = F.CCSMCollection.extend({
        model: F.Tag,
        urn: '/v1/tag/',

        query: async function(raw_expr) {
            /* Use our tag expression grammer to filter this collection down. */
            const parsed = tagParser.parse(raw_expr);
            if (parsed.errors.length) {
                throw new Error(parsed.errors);
            }
            const norm = await tagParser.normalize(parsed.expr, {
                tagSlugToId: slug => this.findWhere({slug}).id
            });
            const resolved = await tagParser.resolve(norm, {
                tagIdToUserIds: function(id) {
                    const tag = this.get(id);
                    const users = tag.get('users');
                    console.log(users);
                }.bind(this)
            });
            console.log(resolved);
            debugger;
        }
    });
})();
