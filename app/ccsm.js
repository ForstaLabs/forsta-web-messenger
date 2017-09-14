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

    if (!F.env.CCSM_API_URL) {
        ns.getUrl = () => ns.getConfig().API.URLS.BASE;
    } else {
        ns.getUrl = () => F.env.CCSM_API_URL;
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
            const msg = urn + ` (${await resp.text()})`;
            if (resp.status === 404) {
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

    ns.login = async function() {
        F.currentUser = null;
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

    ns.logout = function() {
        F.currentUser = null;
        localStorage.removeItem(userConfigKey);
        Raven.setUserContext();
        location.assign(F.urls.logout);
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
        //const tagSplitRe = /([\s()^&+-]+)/;  // XXX spaces still permissible
        const tagSplitRe = /([\s()^&+]+)/;
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
