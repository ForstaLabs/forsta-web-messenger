// vim: ts=4:sw=4:expandtab
/* global md5 */

(function () {
    'use strict';

    self.F = self.F || {};

    F.User = F.AtlasModel.extend({
        urn: '/v1/user/',
        readCacheTTL: 120,

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
            options = options || {};
            return {
                id: this.id,
                link: !options.nolink,
                url: await this.getAvatarURL(options),
                title: this.getName(),
                color: this.getColor()
            };
        },

        getAvatarURL: async function(options) {
            if (this.get('pending')) {
                return await F.util.textAvatarURL('📲', '#444');
            }
            if (!(options && options.size) && this.get('gravatarSize')) {
                options = options || {};
                options.size = this.get('gravatarSize');
            }
            const hash = this.get('gravatar_hash') ||
                         md5((this.get('email') || '').trim().toLowerCase());
            return await F.util.gravatarURL(hash, options) ||
                   await F.util.textAvatarURL(this.getInitials(), this.getColor());
        },

        getColor: function() {
            return F.util.pickColor(this.id);
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
                const curOrg = F.currentUser && F.currentUser.get('org').id;
                if (org && (forceFull || org.id !== curOrg)) {
                    return `@${tag.slug}:${org.slug}`;
                } else {
                    return `@${tag.slug}`;
                }
            }
        },

        getIdentityWords: async function() {
            const identKey = await F.foundation.relayStore.loadIdentity(this.id);
            debugger;
        }
    });

    F.UserCollection = F.AtlasCollection.extend({
        model: F.User,
        urn: '/v1/user/?user_type=PERSON',
        readCacheTTL: 120
    });
})();
