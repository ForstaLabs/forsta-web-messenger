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
        /* Monitor Atlas fetch requests for auth failures and signout when needed. */
        try {
            return await fetchAtlasSave.apply(this, arguments);
        } catch(e) {
            if (e.code === 401) {
                console.error("Atlas auth failure:  Signing out...", e);
                await ns.signout();
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

    async function setCurrentUser(id) {
        const contacts = F.foundation.getContacts();
        await contacts.fetch();
        let user = contacts.get(id);
        if (!user) {
            console.warn("Loading current user from network...");
            user = new F.User({id});
            await user.fetch();
            contacts.add(user);
        }
        F.currentUser = user;
        F.currentDevice = await F.state.get('deviceId');
        F.util.setIssueReportingContext({
            id,
            slug: user.getTagSlug(/*forceFull*/ true),
            name: user.getName()
        });
    }

    async function _login() {
        const config = getLocalConfig();
        if (!config || !config.API || !config.API.TOKEN) {
            console.warn("Invalid localStorage config: Signing out...");
            location.assign(F.urls.signin);
            return await relay.util.never();
        }
        const token = relay.hub.decodeAtlasToken(config.API.TOKEN);
        const id = token.payload.user_id;
        F.Database.setId(id);
        await F.foundation.initRelay();
        await relay.hub.setAtlasConfig(config); // Stay in sync with relay.
        if (F.env.ATLAS_URL) {
            relay.hub.setAtlasUrl(F.env.ATLAS_URL);
        } else {
            relay.hub.setAtlasUrl(config.API.URLS.BASE);
        }
        await setCurrentUser(id);
        relay.util.sleep(60).then(() => relay.hub.maintainAtlasToken(/*forceRefresh*/ true,
                                                                     onRefreshToken));
    }

    let _loginUsed;
    ns.login = async function() {
        if (_loginUsed) {
            throw TypeError("login is not idempotent");
        } else {
            _loginUsed = true;
        }
        try {
            await _login();
        } catch(e) {
            console.error("Login Failure:", e);
            await F.util.confirmModal({
                header: 'Signin Failure',
                icon: 'warning sign yellow',
                content: 'A problem occured while establishing a session...<pre>' + e + '</pre>',
                confirmLabel: 'Sign out',
                confirmIcon: 'sign out',
                dismiss: false,
                closable: false
            });
            location.assign(F.urls.signin);
            await relay.util.never();
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
            await self.registration.unregister();
            throw new ReferenceError("Worker Login Failed: No Atlas config found");
        }
        if (F.env.ATLAS_URL) {
            relay.hub.setAtlasUrl(F.env.ATLAS_URL);
        } else {
            const config = await relay.hub.getAtlasConfig();
            relay.hub.setAtlasUrl(config.API.URLS.BASE);
        }
        await setCurrentUser(id);
    };

    ns.signout = async function() {
        F.currentUser = null;
        if (self.localStorage) {
            localStorage.removeItem(userConfigKey);
        }
        await relay.hub.setAtlasConfig(null);
        F.util.setIssueReportingContext();  // clear it
        if (location.assign) {
            location.assign(F.urls.signin);
        } else {
            /* We're a service worker, just post a quick note and unregister. */
            await self.registration.showNotification('Forsta Messenger Signout', {
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

    ns.getUsersFromCache = F.cache.ttl(86400, relay.hub.getUsers);

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
            await Promise.all((await ns.getUsersFromCache(missing, /*onlyDir*/ true)).map(async x => {
                const c = new F.Contact(x);
                await c.save();
                contactsCol.add(c);
                contacts.push(c);
            }));
        }
        return contacts;
    };

    ns.getContact = async function(userId) {
        return (await ns.getContacts([userId]))[0];
    };

    ns.getOrg = async function(id) {
        if (!id) {
            return new F.Org();
        }
        if (id === F.currentUser.get('org').id) {
            return new F.Org(await ns.fetchFromCache(86400, `/v1/org/${id}/`));
        }
        const resp = await ns.fetchFromCache(86400, `/v1/directory/domain/?id=${id}`);
        if (resp.results.length) {
            return new F.Org(resp.results[0]);
        } else {
            console.warn("Org not found:", id);
            return new F.Org({id});
        }
    };

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
        /* Marry server device list with information we discovered via gossip. */
        const devices = (await relay.hub.fetchAtlas('/v1/provision/account')).devices;
        const devicesLocalInfo = (await F.state.get('ourDevices')) || new Map();
        for (const x of devices) {
            Object.assign(x, devicesLocalInfo.get(x.id));
        }
        return devices;
    };

    const universalTagRe = /^<[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>$/;
    ns.isUniversalTag = function(tag) {
        return !!(tag && tag.match(universalTagRe));
    };

    const tagsCacheTTLMax = 86400 * 1000;
    const tagsCacheTTLRefresh = 900 * 1000;
    const tagsCacheStore = F.cache.getTTLStore(tagsCacheTTLMax, 'atlas-tags', {jitter: 0.01});
    const pendingTagJobs = [];
    let activeTagRequest;

    async function tagRequestExecutor() {
        activeTagRequest = true;
        try {
           await _tagRequestExecutor();
        } catch(e) {
            for (const x of pendingTagJobs) {
                x.reject(e);
            }
            throw e;
        } finally {
            activeTagRequest = false;
        }
    }

    async function _tagRequestExecutor() {
        let throttle = 0.1;
        while (pendingTagJobs.length) {
            await relay.util.sleep(throttle);
            const jobs = Array.from(pendingTagJobs);
            pendingTagJobs.length = 0;
            const mergedMissing = new F.util.DefaultMap(() => []);
            for (const job of jobs) {
                for (const m of job.missing) {
                    mergedMissing.get(m.expr).push({
                        idx: m.idx,
                        expr: m.expr,
                        job
                    });
                }
            }
            const uniqueExpressions = Array.from(mergedMissing.keys());
            const filled = await relay.hub.resolveTagsBatch(uniqueExpressions);
            for (let i = 0; i < filled.length; i++) {
                const value = filled[i];
                const expr = uniqueExpressions[i];
                for (const meta of mergedMissing.get(expr)) {
                    meta.job.results[meta.idx] = value;
                }
                await tagsCacheStore.set(expr, value);
            }
            for (const job of jobs) {
                job.resolve();
            }
            throttle *= 1.5;
        }
    }

    ns.resolveTagsBatchFromCache = async function(expressions, options) {
        options = options || {};
        const refresh = options.refresh;
        let missing;
        let results;
        if (refresh) {
            results = [];
            missing = expressions.map((expr, idx) => ({expr, idx}));
        } else {
            missing = [];
            results = await Promise.all(expressions.map(async (expr, idx) => {
                let hit;
                try {
                    hit = await tagsCacheStore.get(expr, /*keepExpired*/ !navigator.onLine);
                } catch(e) {
                    if (e instanceof F.cache.Expired) {
                        console.warn("Returning expired cache entry while offline:", expr);
                        return e.value;
                    } else if (!(e instanceof F.cache.CacheMiss)) {
                        throw e;
                    }
                }
                if (hit) {
                    if (hit.expiration - Date.now() < tagsCacheTTLMax - tagsCacheTTLRefresh) {
                        // Reduce potential cache miss in future with background refresh now.
                        console.debug("Background refresh of tag expr", expr);
                        F.util.idle().then(() => ns.resolveTagsBatchFromCache([expr], {refresh: true}));
                    }
                    return hit.value;
                } else {
                    missing.push({idx, expr});
                }
            }));
        }
        if (missing.length) {
            const jobDone = new Promise((resolve, reject) => {
                pendingTagJobs.push({missing, results, resolve, reject});
            });
            if (!activeTagRequest) {
                tagRequestExecutor();
            }
            await jobDone;
        }
        return results;
    };

    ns.resolveTagsFromCache = async function(expression, options) {
        return (await ns.resolveTagsBatchFromCache([expression], options))[0];
    };
})();
