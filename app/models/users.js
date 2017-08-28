/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.User = F.CCSMModel.extend({
        urn: '/v1/user/',

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
            return await F.util.gravatarURL(this.get('email'), options) ||
                   await F.util.textAvatar(this.getInitials(), this.getColor());
        },

        getColor: function() {
            return F.util.pickColor(this.id);
        },

        getIdentityKey: async function() {
            return await textsecure.store.getIdentityKey(this.id).get('publicKey');
        },

        getDomain: async function() {
            return await F.ccsm.domainLookup(this.get('org_id'));
        },

        getSlug: function() {
            return this.get('tag').slug;
        },

        getFQSlug: async function() {
            const domain = await this.getDomain();
            return [this.get('tag').slug, domain.get('slug')].join(':');
        }
    });

    F.UserCollection = F.CCSMCollection.extend({
        model: F.User,
        urn: '/v1/user/'
    });
})();
