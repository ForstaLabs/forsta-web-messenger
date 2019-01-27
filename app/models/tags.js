// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.Tag = F.AtlasModel.extend({
        urn: '/v1/tag/',
        readCacheTTL: 3600,

        toString: function() {
            return `<Tag id:${this.id} ${this.getSlug(/*forceFull*/ true)}>`;
        },

        getSlug: function(forceFull) {
            const slug = this.get('slug');
            const org = this.get('org');
            const curOrg = F.currentUser && F.currentUser.get('org').id;
            if (org && (forceFull || org.id !== curOrg)) {
                return `@${slug}:${org.slug}`;
            } else {
                return `@${slug}`;
            }
        },

        getMembers: async function(onlyDirect) {
            if (onlyDirect) {
                return this.get('users').map(x => x.user.id);
            } else {
                const resolved =  await F.atlas.resolveTagsFromCache(this.getSlug());
                return resolved.userids;
            }
        },

        getContacts: async function(onlyDirect) {
            return (await F.atlas.getContacts(await this.getMembers(onlyDirect))).filter(x => x);
        },

        getUser: async function() {
            const user = this.get('user');
            return user && await F.atlas.getContact(user.id);
        },

        getParents: async function() {
            return await Promise.all(this.get('parents').map(async x => F.atlas.getTag(x)));
        },

        getChildren: async function() {
            return await Promise.all(this.get('children').map(async x => F.atlas.getTag(x)));
        }
    });

    F.TagCollection = F.AtlasCollection.extend({
        model: F.Tag,
        urn: '/v1/tag/',
        readCacheTTL: 3600
    });
})();
