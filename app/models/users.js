// vim: ts=4:sw=4:expandtab
/* global md5 */

(function () {
    'use strict';

    self.F = self.F || {};

    F.User = F.CCSMModel.extend({
        urn: '/v1/user/',
        readCacheTTL: 60,

        getName: function() {
            const names = [];
            const f = this.get('first_name');
            const l = this.get('last_name');
            if (f) {
                names.push(f);
            }
            if (l) {
                names.push(l);
            }
            return names.join(' ');
        },

        getInitials: function(count) {
            count = count || 2;
            const initials = [];
            const f = this.get('first_name');
            const m = this.get('middle_name');
            const l = this.get('last_name');
            if (f) {
                initials.push(f[0]);
            }
            if (count >= 3 && m) {
                initials.push(m[0]);
            }
            if (count >= 2 && l) {
                initials.push(l[0]);
            }
            return initials.join('').toUpperCase();
        },

        getAvatar: async function(options) {
            return {
                id: this.id,
                url: await this.getAvatarURL(options),
                title: this.getName(),
                color: this.getColor()
            };
        },

        getAvatarURL: async function(options) {
            if (!(options && options.size) && this.get('gravatarSize')) {
                options = options || {};
                options.size = this.get('gravatarSize');
            }
            // XXX It would be nice if the server API always provided gravatar_hash.
            const hash = this.get('gravitar_hash') || // XXX Gravatar is spelled wrong in the API..
                         this.get('gravatar_hash') ||
                         md5((this.get('email') || '').trim().toLowerCase());
            return await F.util.gravatarURL(hash, options) ||
                   await F.util.textAvatarURL(this.getInitials(), this.getColor());
        },

        getColor: function() {
            return F.util.pickColor(this.id);
        },

        getIdentityKey: async function() {
            return await textsecure.store.getIdentityKey(this.id).get('publicKey');
        },

        getDomainId: function() {
            // The API on user is inconsistent regarding org unfortunately.
            // XXX Jeff may correct this..  Keep note..
            return this.get('org_id') || this.get('org').id;
        },

        getDomain: async function() {
            return await F.ccsm.domainLookup(this.getDomainId());
        },

        getSlug: function() {
            const tag = this.get('tag');
            if (!tag) {
                console.warn("Missing tag for user:", this.id, this);
                return;
            } else {
                return tag.slug;
            }
        },

        getFQSlug: async function() {
            const slug = this.getSlug();
            if (!slug) {
                return;
            }
            const domain = await this.getDomain();
            return [slug, domain.get('slug')].join(':');
        }
    });

    F.UserCollection = F.CCSMCollection.extend({
        model: F.User,
        urn: '/v1/user/',
        readCacheTTL: 60
    });
})();
