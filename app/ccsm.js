// vim: ts=4:sw=4:expandtab
/* global Raven, ga, moment */

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

    ns.setConfig = function(data) {
        const json = JSON.stringify(data);
        localStorage.setItem(userConfigKey, json);
    };

    if (!F.env.CCSM_API_URL) {
        ns.getUrl = () => ns.getConfig().API.URLS.BASE;
    } else {
        ns.getUrl = () => F.env.CCSM_API_URL;
    }

    ns.decodeAuthToken = function(encoded_token) {
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

    ns.getEncodedAuthToken = function() {
        const config = ns.getConfig();
        if (!config || !config.API || !config.API.TOKEN) {
            throw ReferenceError("No Token Found");
        }
        return config.API.TOKEN;
    },

    ns.updateEncodedAuthToken = function(encodedToken) {
        const config = ns.getConfig();
        if (!config || !config.API || !config.API.TOKEN) {
            throw ReferenceError("No Token Found");
        }
        config.API.TOKEN = encodedToken;
        ns.setConfig(config);
    },

    ns.getAuthToken = function() {
        const token = ns.decodeAuthToken(ns.getEncodedAuthToken());
        if (!token.payload || !token.payload.exp) {
            throw TypeError("Invalid Token");
        }
        if (token.payload.exp * 1000 <= Date.now()) {
            throw Error("Expired Token");
        }
        return token;
    };

    ns.fetchResource = async function ccsm_fetchResource(urn, options) {
        options = options || {};
        options.headers = options.headers || new Headers();
        try {
            const encodedToken = ns.getEncodedAuthToken();
            options.headers.set('Authorization', `JWT ${encodedToken}`);
        } catch(e) {
            /* Almost certainly will blow up soon (via 400s), but lets not assume
             * all API access requires auth regardless. */
            console.warn("Auth token missing or invalid", e);
        }
        options.headers.set('Content-Type', 'application/json; charset=utf-8');
        if (options.json) {
            options.body = JSON.stringify(options.json);
        }
        const url = [ns.getUrl(), urn.replace(/^\//, '')].join('/');
        const resp = await fetch(url, options);
        if (!resp.ok) {
            const msg = urn + ` (${await resp.text()})`;
            if (resp.status === 401 || resp.status === 403) {
                console.error("Auth token is invalid.  Logging out...");
                await ns.logout();
                throw new Error("logout - unreachable"); // just incase logout blows up.
            } else if (resp.status === 404) {
                throw new ReferenceError(msg);
            } else {
                throw new Error(msg);
            }
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

    let _loginUsed;
    ns.login = async function() {
        if (_loginUsed) {
            throw TypeError("login is not idempotent");
        } else {
            _loginUsed = true;
        }
        F.currentUser = null;
        let user;
        try {
            await ns.maintainAuthToken();
            const id = ns.getAuthToken().payload.user_id;
            F.Database.setId(id);
            user = new F.User({id});
            await user.fetch();
        } catch(e) {
            console.warn("Login Failure:", e);
            location.assign(F.urls.login);
            return await F.util.never();
        }
        user.set('gravatarSize', 1024);
        F.currentUser = user;
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

    ns.logout = async function() {
        F.currentUser = null;
        localStorage.removeItem(userConfigKey);
        Raven.setUserContext();
        location.assign(F.urls.logout);
        return await F.util.never();
    };

    ns.maintainAuthToken = async function() {
        /* Manage auth token expiration.  This routine will reschedule itself as needed. */
        const refreshOffset = 300;  // Refresh some seconds before it actually expires.
        let token = ns.getAuthToken();
        let needsRefreshIn = (token.payload.exp - refreshOffset) * 1000 - Date.now();
        if (needsRefreshIn < 1000) {
            const encodedToken = ns.getEncodedAuthToken();
            const resp = await ns.fetchResource('/v1/api-token-refresh/', {
                method: 'POST',
                json: {token: encodedToken}
            });
            if (!resp || !resp.token) {
                throw new TypeError("Token Refresh Error");
            }
            ns.updateEncodedAuthToken(resp.token);
            console.info("Refreshed auth token");
            token = ns.getAuthToken();
            needsRefreshIn = (token.payload.exp - refreshOffset) * 1000 - Date.now();
        }
        if (needsRefreshIn <= 0) {
            throw new TypeError("Auth Token Refresh Offset Too Small");
        }
        /* Bound setTimeout; Anything >= 32bit signed int runs immediately */
        const refreshIn = Math.min(needsRefreshIn, (2 ** 31) - 1);
        console.info("Will recheck auth token in " + moment.duration(refreshIn).humanize());
        setTimeout(ns.maintainAuthToken, refreshIn);
    };

    ns.resolveTags = async function(expression) {
        const q = '?expression=' + encodeURIComponent(expression);
        const results = await ns.cachedFetchResource(900, '/v1/directory/user/' + q);
        for (const w of results.warnings) {
            w.context = expression.substring(w.position, w.position + w.length);
            console.warn("Tag Expression Grievance:", w);
        }
        return results;
    };

    ns.sanitizeTags = function(expression) {
        /* Clean up tags a bit. Add @ where needed. */
        const tagSplitRe = /([\s()^&+-]+)/;
        const tags = [];
        for (let tag of expression.trim().split(tagSplitRe)) {
            if (!tag) {
                continue;
            } else if (tag.match(/^[a-zA-Z]/)) {
                tag = '@' + tag;
            }
            tags.push(tag);
        }
        return tags.join(' ');
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
        if (user) {
            return user;
        }
        const data = (await ns.cachedFetchResource(300, '/v1/directory/user/?id=' + userId)).results;
        if (data.length) {
            return new F.User(data[0]);
        }
    };

    ns.tagLookup = async function(tagId) {
        const tag = F.foundation.getTags().get(tagId);
        if (tag) {
            return tag;
        }
        const data = (await ns.cachedFetchResource(300, '/v1/directory/tag/?id=' + tagId)).results;
        if (data.length) {
            return new F.Tag(data[0]);
        }
    };

    ns.domainLookup = async function(domainId) {
        if (!domainId) {
            throw new ReferenceError("domainId not set");
        }
        if (domainId === F.currentUser.getDomainId()) {
            return new F.Domain(await ns.cachedFetchResource(900, `/v1/org/${domainId}/`));
        }
        const data = (await ns.cachedFetchResource(7200, '/v1/directory/domain/?id=' + domainId)).results;
        if (data.length) {
            return new F.Domain(data[0]);
        } else {
            console.warn("Domain not found:", domainId);
        }
    };
})();
