// vim: ts=4:sw=4:expandtab
/* global tagParser */

(function () {
    'use strict';

    self.F = self.F || {};

    const TAG_MEMBERS = new Set(['USERNAME', 'MEMBEROF']);

    F.Tag = F.CCSMModel.extend({
        urn: '/v1/tag/'
    });

    F.TagCollection = F.CCSMCollection.extend({
        model: F.Tag,
        urn: '/v1/tag/',

        compileExpression: async function(raw_expr) {
            const parsed = tagParser.parse(raw_expr);
            if (parsed.errors.length) {
                throw new Error(parsed.errors);
            }
            const normalized = await tagParser.normalize(parsed.expr, slug =>
                this.findWhere({slug: slug.substring(1)}).id);
            const users = await tagParser.resolve(normalized, id =>
                this.get(id).get('users').filter(x =>
                    TAG_MEMBERS.has(x.association_type)).map(x =>
                        x.user.id));
            return {
                normalized,
                users
            };
        }
    });
})();
