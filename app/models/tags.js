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

        resolveUsers: async function(raw_expr) {
            const parsed = tagParser.parse(raw_expr);
            if (parsed.errors.length) {
                throw new Error(parsed.errors);
            }
            const norm = await tagParser.normalize(parsed.expr, {
                tagSlugToId: slug => this.findWhere({slug}).id
            });
            return await tagParser.resolve(norm, {
                tagIdToUserIds: id => this.get(id).get('users').map(x => x.id)
            });
        }
    });
})();
