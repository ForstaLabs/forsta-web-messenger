// vim: ts=4:sw=4:expandtab
/* global relay */

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

    const fetchAtlasSave = relay.hub.fetchAtlas;
    async function fetchAtlasWrap() {
        /* Monitor Atlas fetch requests for auth failures and logout when needed. */
        try {
            return await fetchAtlasSave.apply(this, arguments);
        } catch(e) {
            if (e.code === 401) {
                console.error("Atlas auth failure:  Logging out...", e);
                await ns.logout();
            } else {
                if (navigator.onLine) {
                    console.error("Atlas fetch failure:", arguments[0], e);
                } else {
                    // XXX Suspend site?
                    console.warn("Atlas fetch failed while OFFLINE:", arguments[0], e);
                }
                throw e;
            }
        }
    }
    relay.hub.fetchAtlas = fetchAtlasWrap;

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
            slug: user.getTagSlug(/*forceFull*/ true),
            phone: user.get('phone'),
            name: user.getName()
        });
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
            slug: user.getTagSlug(/*forceFull*/ true),
            phone: user.get('phone'),
            name: user.getName()
        });
    };

    ns.logout = async function() {
        F.currentUser = null;
        if (self.localStorage) {
            localStorage.removeItem(userConfigKey);
        }
        await relay.hub.setAtlasConfig(null);
        F.util.setIssueReportingContext();  // clear it
        if (location.assign) {
            location.assign(F.urls.logout);
        } else {
            /* We're a service worker, just post a quick note and unregister. */
            await self.registration.showNotification('Forsta Messenger Logout', {
                body: 'Your session has ended.',
                icon: F.util.versionedURL(F.urls.static + 'images/logo_metal_bg_256.png'),
            });
            await self.registration.unregister();
        }
        await relay.util.never();
    };

    const _fetchCacheFuncs = new Map();
    ns.fetchFromCache = async function(ttl, urn, options) {
        if (!_fetchCacheFuncs.has(ttl)) {
            _fetchCacheFuncs.set(ttl, F.cache.ttl(ttl, relay.hub.fetchAtlas));
        }
        return await _fetchCacheFuncs.get(ttl).call(this, urn, options);
    };

    const getUsersFromCache = F.cache.ttl(900, relay.hub.getUsers);

    ns.searchContacts = async function(query, options) {
        options = options || {};
        const fetches = [];
        if (options.disjunction) {
            for (const [key, val] of Object.entries(query)) {
                const q = F.util.urlQuery({[key]: val});
                if (q) {
                    fetches.push(relay.hub.fetchAtlas('/v1/directory/user/' + q));
                }
            }
        } else {
            const q = F.util.urlQuery(query);
            if (q) {
                fetches.push(relay.hub.fetchAtlas('/v1/directory/user/' + q));
            }
        }
        const ids = new Set();
        const results = [];
        for (const resp of await Promise.all(fetches)) {
            for (const data of resp.results) {
                console.assert(!resp.next, 'paging not implemented yet');
                if (!ids.has(data.id)) {
                    ids.add(data.id);
                    results.push(new F.Contact(data));
                }
            }
        }
        return results;
    };

    ns.getContacts = async function(userIds) {
        const missing = [];
        const contacts = [];
        const contactsCol = F.foundation.getContacts();
        for (const id of userIds) {
            const c = contactsCol.get(id);
            if (c) {
                contacts.push(c);
            } else {
                missing.push(id);
            }
        }
        if (missing.length) {
            await Promise.all((await getUsersFromCache(missing, /*onlyDir*/ true)).map(async x => {
                const c = new F.Contact(x);
                await c.save();
                contactsCol.add(c);
                contacts.push(c);
            }));
        }
        return contacts;
    };

    ns.getOrg = async function(id) {
        if (!id) {
            return new F.Org();
        }
        if (id === F.currentUser.get('org').id) {
            return new F.Org(await ns.fetchFromCache(3600, `/v1/org/${id}/`));
        }
        const resp = await ns.fetchFromCache(3600, `/v1/directory/domain/?id=${id}`);
        if (resp.results.length) {
            return new F.Org(resp.results[0]);
        } else {
            console.warn("Org not found:", id);
            return new F.Org({id});
        }
    };

    ns.resolveTagsFromCache = F.cache.ttl(900, relay.hub.resolveTags);

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
            return (await relay.hub.fetchAtlas('/v1/provision/account')).devices;
        } catch(e) {
            if (e instanceof ReferenceError) {
                /* XXX: Only legacy atlas servers do this now.  Can remove after feb 2018 */
                return [];
            } else {
                throw e;
            }
        }
    };

    const universalTagRe = /^<[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>$/;
    ns.isUniversalTag = function(tag) {
        return !!(tag && tag.match(universalTagRe));
    };
})();
