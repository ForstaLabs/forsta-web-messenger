// vim: ts=4:sw=4:expandtab
/* global ga relay */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.atlas = {};
    const userConfigKey = 'DRF:STORAGE_USER_CONFIG';

    function getLocalConfig() {
        /* Local storage config for atlas (keeps other atlas ui happy) */
        const raw = localStorage.getItem(userConfigKey);
        return raw && JSON.parse(raw);
    }

    function setLocalConfig(data) {
        /* Local storage config for atlas (keeps other atlas ui happy) */
        const json = JSON.stringify(data);
        localStorage.setItem(userConfigKey, json);
    }

    async function onRefreshToken() {
        /* Stay in sync with relay. */
        setLocalConfig(await relay.hub.getAtlasConfig());
    }

    let _loginUsed;
    ns.login = async function() {
        if (_loginUsed) {
            throw TypeError("login is not idempotent");
        } else {
            _loginUsed = true;
        }
        let user;
        try {
            const config = getLocalConfig();
            const token = relay.hub.decodeAtlasToken(config.API.TOKEN);
            const userId = token.payload.user_id;
            F.Database.setId(userId);
            await F.foundation.initRelay();
            await relay.hub.setAtlasConfig(config); // Stay in sync with relay.
            if (F.env.ATLAS_API_URL) {
                relay.hub.setAtlasUrl(F.env.ATLAS_API_URL);
            } else {
                relay.hub.setAtlasUrl(config.API.URLS.BASE);
            }
            user = new F.User({id: userId});
            await user.fetch();
        } catch(e) {
            console.warn("Login Failure:", e);
            location.assign(F.urls.logout);
            return await relay.util.never();
        }
        relay.util.sleep(60).then(() => relay.hub.maintainAtlasToken(/*forceRefresh*/ true,
                                                                     onRefreshToken));
        user.set('gravatarSize', 1024);
        F.currentUser = user;
        F.util.setIssueReportingContext({
            email: user.get('email'),
            id: user.id,
            slug: '@' + await user.getFQSlug(),
            phone: user.get('phone'),
            name: user.getName()
        });
        if (self.ga && F.env.GOOGLE_ANALYTICS_UA) {
            ga('set', 'userId', user.id);
        }
    };

    ns.workerLogin = async function(id) {
        if (_loginUsed) {
            throw TypeError("login is not idempotent");
        } else {
            _loginUsed = true;
        }
        F.Database.setId(id);
        await F.foundation.initRelay();
        const config = await relay.hub.getAtlasConfig();
        if (!config) {
            throw new ReferenceError("Worker Login Failed: No Atlas config found");
        }
        if (F.env.ATLAS_API_URL) {
            relay.hub.setAtlasUrl(F.env.ATLAS_API_URL);
        } else {
            const config = await relay.hub.getAtlasConfig();
            relay.hub.setAtlasUrl(config.API.URLS.BASE);
        }
        const user = new F.User({id});
        await user.fetch();
        F.currentUser = user;
        F.util.setIssueReportingContext({
            email: user.get('email'),
            id: user.id,
            slug: '@' + await user.getFQSlug(),
            phone: user.get('phone'),
            name: user.getName()
        });
    };

    ns.logout = async function() {
        F.currentUser = null;
        if (self.localStorage) {
            localStorage.removeItem(userConfigKey);
        }
        F.util.setIssueReportingContext();  // clear it
        location.assign(F.urls.logout);
        return await relay.util.never();
    };

    ns.fetch = async function() {
        try {
            return relay.hub.fetchAtlas.apply(this, arguments);
        } catch(e) {
            if (e.code === 401) {
                console.error("Atlas auth failure:  Logging out...");
                await ns.logout();
            } else {
                throw e;
            }
        }
    };

    const _fetchCacheFuncs = new Map();
    ns.fetchFromCache = async function(ttl, urn, options) {
        if (!_fetchCacheFuncs.has(ttl)) {
            _fetchCacheFuncs.set(ttl, F.cache.ttl(ttl, ns.fetch));
        }
        return await _fetchCacheFuncs.get(ttl).call(this, urn, options);
    };

    const getUsersFromCache = F.cache.ttl(900, relay.hub.getUsers);

    ns.usersLookup = async function(userIds) {
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
            for (const x of await getUsersFromCache(missing, /*onlyDir*/ true)) {
                users.push(new F.User(x));
            }
        }
        return users;
    };

    ns.orgLookup = async function(id) {
        if (!id) {
            throw new TypeError("id required");
        }
        if (id === F.currentUser.get('org').id) {
            return new F.Org(await ns.fetchFromCache(1800, `/v1/org/${id}/`));
        }
        const resp = await ns.fetchFromCache(1800, `/v1/directory/domain/?id=${id}`);
        if (resp.results.length) {
            return new F.Org(resp.results[0]);
        } else {
            console.warn("Org not found:", id);
        }
    };

    ns.resolveTagsFromCache = F.cache.ttl(300, relay.hub.resolveTags);

    ns.diffTags = async function(aDist, bDist) {
        const a = await ns.resolveTagsFromCache(aDist);
        const b = await ns.resolveTagsFromCache(bDist);
        const newInc = new F.util.ESet(b.includedTagids);
        const oldInc = new F.util.ESet(a.includedTagids);
        const newEx = new F.util.ESet(b.excludedTagids);
        const oldEx = new F.util.ESet(a.excludedTagids);
        let added = newInc.difference(oldInc);
        added = added.union(oldEx.difference(newEx));
        let removed = oldInc.difference(newInc);
        removed = removed.union(newEx.difference(oldEx));
        return {
            added,
            removed
        };
    };

    ns.getDevices = async function() {
        try {
            return (await ns.fetch('/v1/provision/account')).devices;
        } catch(e) {
            if (e instanceof ReferenceError) {
                return undefined;
            } else {
                throw e;
            }
        }
    };
})();
