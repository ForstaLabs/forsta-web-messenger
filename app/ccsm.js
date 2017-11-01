// vim: ts=4:sw=4:expandtab
/* global ga relay */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.ccsm = {};
    const userConfigKey = 'DRF:STORAGE_USER_CONFIG';

    function getLocalConfig() {
        /* Local storage config for ccsm (keeps other ccsm ui happy) */
        const raw = localStorage.getItem(userConfigKey);
        return raw && JSON.parse(raw);
    }

    function setLocalConfig(data) {
        /* Local storage config for ccsm (keeps other ccsm ui happy) */
        const json = JSON.stringify(data);
        localStorage.setItem(userConfigKey, json);
    }

    async function onRefreshToken() {
        /* Stay in sync with relay. */
        setLocalConfig(await relay.ccsm.getConfig());
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
            const token = relay.ccsm.decodeAuthToken(config.API.TOKEN);
            const userId = token.payload.user_id;
            F.Database.setId(userId);
            await F.foundation.initRelay();
            await relay.ccsm.setConfig(config); // Stay in sync with relay.
            if (F.env.CCSM_API_URL) {
                relay.ccsm.setUrl(F.env.CCSM_API_URL);
            } else {
                relay.ccsm.setUrl(config.API.URLS.BASE);
            }
            user = new F.User({id: userId});
            await user.fetch();
        } catch(e) {
            console.warn("Login Failure:", e);
            location.assign(F.urls.logout);
            return await relay.util.never();
        }
        relay.util.sleep(60).then(() => relay.ccsm.maintainAuthToken(/*forceRefresh*/ true,
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
        if (F.env.CCSM_API_URL) {
            relay.ccsm.setUrl(F.env.CCSM_API_URL);
        } else {
            const config = await relay.ccsm.getConfig();
            relay.ccsm.setUrl(config.API.URLS.BASE);
        }
        F.currentUser = new F.User({id});
        await F.currentUser.fetch();
    };

    ns.logout = async function() {
        F.currentUser = null;
        if (self.localStorage) {
            localStorage.removeItem(userConfigKey);
        }
        await F.state.remove('ccsmConfig');
        F.util.setIssueReportingContext();  // clear it
        location.assign(F.urls.logout);
        return await relay.util.never();
    };

    const _fetchResourceCacheFuncs = new Map();
    ns.fetchResourceFromCache = async function(ttl, urn, options) {
        if (!_fetchResourceCacheFuncs.has(ttl)) {
            _fetchResourceCacheFuncs.set(ttl, F.cache.ttl(ttl, relay.ccsm.fetchResource));
        }
        return await _fetchResourceCacheFuncs.get(ttl).call(this, urn, options);
    };


    const getUsersFromCache = F.cache.ttl(900, relay.ccsm.getUsers);

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
            for (const x of await getUsersFromCache(missing)) {
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
            return new F.Org(await ns.fetchResourceFromCache(1800, `/v1/org/${id}/`));
        }
        const resp = await ns.fetchResourceFromCache(1800, `/v1/directory/domain/?id=${id}`);
        if (resp.results.length) {
            return new F.Org(resp.results[0]);
        } else {
            console.warn("Org not found:", id);
        }
    };

    ns.resolveTagsFromCache = F.cache.ttl(300, relay.ccsm.resolveTags);

    ns.getDevices = async function() {
        try {
            return (await relay.ccsm.fetchResource('/v1/provision/account')).devices;
        } catch(e) {
            if (e instanceof ReferenceError) {
                return undefined;
            } else {
                throw e;
            }
        }
    };
})();
