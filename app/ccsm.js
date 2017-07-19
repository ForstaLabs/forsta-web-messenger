// vim: ts=4:sw=4:expandtab
/* global Raven */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.ccsm = {};
    const userConfigKey = 'DRF:STORAGE_USER_CONFIG';

    function atobJWT(str) {
        /* See: https://github.com/yourkarma/JWT/issues/8 */
        return atob(str.replace(/_/g, '/').replace(/-/g, '+'));
    }

    ns.getConfig = function() {
        const raw = localStorage.getItem(userConfigKey);
        return raw && JSON.parse(raw);
    };

    ns.decodeToken = function(encoded_token) {
        try {
            const parts = encoded_token.split('.').map(atobJWT);
            return {
                header: JSON.parse(parts[0]),
                payload: JSON.parse(parts[1]),
                secret: parts[2]
            };
        } catch(e) {
            throw new Error('Invalid Token');
        }
    };

    ns.getTokenInfo = function() {
        const config = ns.getConfig();
        if (!config || !config.API || !config.API.TOKEN) {
            throw Error("No Token Found");
        }
        return ns.decodeToken(config.API.TOKEN);
    };

    ns.fetchUser = async function() {
        const user = new F.User({id: F.ccsm.getTokenInfo().payload.user_id});
        await user.fetch();
        user.set('gravatarSize', 1024);
        Raven.setUserContext({
            email: user.get('email'),
            username: user.get('username'),
            phone: user.get('phone'),
            name: user.getName()
        });
        return user;
    };

    ns.logout = function() {
        localStorage.removeItem(userConfigKey);
        Raven.setUserContext();
        location.assign(F.urls.logout);
    };
})();
