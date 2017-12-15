// vim: ts=4:sw=4:expandtab
/* global md5 relay */

(function () {
    'use strict';

    self.F = self.F || {};

    F.User = F.AtlasModel.extend({
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
            const hash = this.get('gravatar_hash') ||
                         md5((this.get('email') || '').trim().toLowerCase());
            const text = this.get('pending') ? '📲' : this.getInitials();
            return await F.util.gravatarURL(hash, options) ||
                   await F.util.textAvatarURL(text, this.getColor());
        },

        getColor: function() {
            return F.util.pickColor(this.id);
        },

        getIdentityKey: async function() {
            return await relay.store.getIdentityKey(this.id).get('publicKey');
        },

        getOrg: async function() {
            return await F.atlas.getOrg(this.get('org').id);
        },

        getTagSlug: function(forceFull) {
            const tag = this.get('tag');
            if (!tag || !tag.slug) {
                return;
            } else {
                const org = this.get('org');
                if (org && (forceFull || org.id !== F.currentUser.get('org').id)) {
                    return `@${tag.slug}:${org.slug}`;
                } else {
                    return `@${tag.slug}`;
                }
            }
        }
    });

    F.UserCollection = F.AtlasCollection.extend({
        model: F.User,
        urn: '/v1/user/?user_type=PERSON',
        readCacheTTL: 60
    });
})();
