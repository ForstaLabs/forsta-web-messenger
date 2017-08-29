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

    ns.fetchResource = async function ccsm_fetchResource(urn, options) {
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

    const _fetchResourceCacheFuncs = new Map();
    ns.cachedFetchResource = async function(ttl, urn, options) {
        if (!_fetchResourceCacheFuncs.has(ttl)) {
            _fetchResourceCacheFuncs.set(ttl, F.cache.ttl(ttl, ns.fetchResource));
        }
        return await _fetchResourceCacheFuncs.get(ttl).call(this, urn, options);
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
            id: user.id,
            slug: '@' + await user.getFQSlug(),
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
            return await ns.cachedFetchResource(300, '/v1/tag/resolve', {
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

    ns.userDirectoryLookup = async function(userIds) {
        if (!userIds.length) {
            return [];  // Prevent open query that returns world.
        }
        const missing = [];
        const users = [];
        const userCollection = F.foundation.getUsers();
        for (const id of userIds) {
            const user = userCollection.get(id);
            if (user) {
                users.push(user);
            } else {
                missing.push(id);
            }
        }
        if (missing.length) {
            const query = '?id_in=' + missing.join(',');
            const data = (await ns.cachedFetchResource(900, '/v1/directory/user/' + query)).results;
            for (const attrs of data) {
                const user = new F.User(attrs);
                user.set("foreignNational", true);
                users.push(user);
            }
        }
        return users;
    };

    ns.userLookup = async function(userId) {
        const user = F.foundation.getUsers().get(userId);
        if (!user) {
            const data = (await ns.cachedFetchResource(900, '/v1/directory/user/?id=' + userId)).results;
            if (data.length) {
                return new F.User(data[0]);
            }
        } else {
            return user;
        }
    };

    ns.domainLookup = async function(domainId) {
        if (!domainId) {
            throw new ReferenceError("domainId not set");
        }
        const data = (await ns.cachedFetchResource(7200, '/v1/directory/domain/?id=' + domainId)).results;
        if (data.length) {
            return new F.Domain(data[0]);
        } else {
            console.warn("Domain not found:", domainId);
        }
    };
})();
