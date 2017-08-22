// vim: ts=4:sw=4:expandtab
/* global Raven, ga */

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

    if (!forsta_env.CCSM_API_URL) {
        ns.getUrl = () => ns.getConfig().API.URLS.BASE;
    } else {
        ns.getUrl = () => forsta_env.CCSM_API_URL;
    }

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

    ns.fetchResource = async function(urn, options) {
        const cfg = ns.getConfig().API;
        options = options || {};
        options.headers = options.headers || new Headers();
        options.headers.set('Authorization', `JWT ${cfg.TOKEN}`);
        options.headers.set('Content-Type', 'application/json; charset=utf-8');
        if (options.json) {
            options.body = JSON.stringify(options.json);
        }
        const url = [ns.getUrl(), urn.replace(/^\//, '')].join('/');
        const resp = await fetch(url, options);
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        return await resp.json();
    };

    ns.login = async function() {
        let user;
        try {
            const id = F.ccsm.getTokenInfo().payload.user_id;
            F.Database.setId(id);
            user = new F.User({id});
            await user.fetch();
        } catch(e) {
            console.warn("Login Failure:", e);
            location.assign(F.urls.login);
            throw e;
        }
        user.set('gravatarSize', 1024);
        Raven.setUserContext({
            email: user.get('email'),
            username: user.get('username'),
            phone: user.get('phone'),
            name: user.getName()
        });
        if (self.ga) {
            ga('set', 'userId', user.id);
        }
        return user;
    };

    ns.logout = function() {
        localStorage.removeItem(userConfigKey);
        Raven.setUserContext();
        location.assign(F.urls.logout);
    };

    ns.resolveTags = async function(expression) {
        try {
            return await ns.fetchResource('/v1/tag/resolve', {
                method: 'post',
                json: {expression}
            });
        } catch(e) {
            // XXX This API is highly expermental and returns 500 often.
            console.warn("Ignoring CCSM tag/resolve API bug");
            return {
                pretty: '',
                universal: '',
                userids: [],
                warnings: ["XXX"]
            };
        }
    };
})();
