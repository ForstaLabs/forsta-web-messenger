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

        getAvatar: function() {
            return {
                url: this.getAvatarURL(),
                color: this.getColor()
            };
        },

        getAvatarURL: function() {
            return F.util.gravatarURL(this.get('email'));
        },

        getColor: function() {
            return F.util.pickColor(this.id);
        }
    });

    F.UserCollection = F.CCSMCollection.extend({
        model: F.User,
        urn: '/v1/user/'
    });
})();
