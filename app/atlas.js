// vim: ts=4:sw=4:expandtab
/* global relay, md5 */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.atlas = {};

    const logger = F.log.getLogger('atlas');

    const userConfigKey = 'DRF:STORAGE_USER_CONFIG';
    const ephemeralUserKey = 'ephemeralUsers';
    const jwtProxyKey = F.env.JWT_PROXY_LOCALSTORAGE_KEY;
    const useJwtProxy = !!jwtProxyKey;

    let _loginUsed;

    relay.hub.setAtlasUrl(F.env.ATLAS_URL);

    function getLocalConfig() {
        const raw = localStorage.getItem(userConfigKey);
        return raw && JSON.parse(raw);
    }

    function setLocalConfig(data) {
        const json = JSON.stringify(data);
        localStorage.setItem(userConfigKey, json);
    }

    function getEphemeralUserData(hash) {
        const datas = JSON.parse(localStorage.getItem(ephemeralUserKey) || '{}');
        const data = datas[hash];
        if (data && (!data.expire || data.expire > Date.now())) {
            return data;
        }
    }

    function setEphemeralUserData(hash, data) {
        const users = JSON.parse(localStorage.getItem(ephemeralUserKey) || '{}');
        users[hash] = data;
        localStorage.setItem(ephemeralUserKey, JSON.stringify(users));
    }

    ns.fetch = relay.hub.fetchAtlas;

    relay.hub.fetchAtlas = async function() {
        /* Monitor Atlas fetch requests for auth failures and signout when needed. */
        try {
            return await ns.fetch.apply(this, arguments);
        } catch(e) {
            if (e.code === 401) {
                logger.error("Auth failure:  Signing out...", e);
                await ns.signout();
            } else {
                if (navigator.onLine) {
                    logger.error("Fetch failure:", arguments[0], e);
                } else {
                    // XXX Suspend site?
                    logger.warn("Fetch failed while OFFLINE:", arguments[0], e);
                }
                throw e;
            }
        }
    };

    async function setCurrentUser(id) {
        F.Database.setId(id);
        if (!(await relay.hub.getAtlasConfig())) {
            // We were logged in by something external like password-reset or the DB was cleared.
            await relay.hub.setAtlasConfig(getLocalConfig());
        }
        const contacts = F.foundation.getContacts();
        await contacts.fetch();
        let user = contacts.get(id);
        if (!user) {
            logger.warn("Loading current user from network...");
            user = new F.User({id});
            await user.fetch();
            user = new F.Contact(user.attributes);
            await user.save();
            contacts.add(user);
        }
        F.currentUser = user;
        F.currentDevice = await F.state.get('deviceId');
        F.util.setIssueReportingContext({
            id,
            slug: user.getTagSlug({full: true}),
            name: user.getName()
        });
    }

    function getLocalAuth() {
        const config = getLocalConfig();
        if (config && config.API && config.API.TOKEN) {
            try {
                return relay.hub.decodeAtlasToken(config.API.TOKEN);
            } catch(e) {
                logger.warn("Invalid token:", e);
            }
        }
    }

    async function _login() {
        const token = getLocalAuth();
        if (!token) {
            logger.warn("Invalid localStorage config: Signing out...");
            location.assign(F.urls.signin);
            return await F.never();
        }
        await setCurrentUser(token.payload.user_id);
        F.sleep(60).then(() => {
            relay.hub.maintainAtlasToken(/*forceRefresh*/ true, async () => {
                // Keep local-storage db updated as well.
                setLocalConfig(await relay.hub.getAtlasConfig());
            });
        });
    }

    async function _loginJwtProxy() {
        const jwtproxy = localStorage.getItem(jwtProxyKey);
        if (!jwtproxy) {
            throw new Error(`JWT proxy key not found in localstorage: ${jwtProxyKey}`);
        }
        const auth = await relay.hub.fetchAtlas('/v1/login/', {
            skipAuth: true,
            method: 'POST',
            json: {jwtproxy}
        });
        await ns.saveAuth(auth.token);
        F.sleep(60).then(() => {
            relay.hub.maintainAtlasToken(/*forceRefresh*/ true, async () => {
                // Keep local-storage db updated as well.
                setLocalConfig(await relay.hub.getAtlasConfig());
            });
        });
    }

    async function createEphemeralUser(params) {
        const expire = new Date(Date.now() + (86400 * 1000));
        const resp = await fetch(F.env.ATLAS_URL + '/v1/ephemeral-user/', {
            method: 'POST',
            body: JSON.stringify({
                token: params.get('token'),
                expire,
                first_name: params.get('first_name'),
                last_name: params.get('last_name'),
                email: params.get('email'),
                phone: params.get('phone')
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (!resp.ok) {
            throw new TypeError(await resp.text());
        }
        const jwt = (await resp.json()).jwt;
        return {
            jwt,
            expire: expire.getTime()
        };
    }

    async function joinConversation(token, params) {
        const skipAuth = !F.currentUser;
        return await relay.hub.fetchAtlas(`/v1/conversation/${token}/`, {
            skipAuth,
            method: 'POST',
            json: {
                first_name: params.get('first_name'),
                last_name: params.get('last_name'),
            },
        });
    }

    ns.getConversation = async function(token) {
        const resp = await relay.hub.fetchAtlas(`/v1/conversation/${token}/`, {rawResponse: true});
        if (resp.ok) {
            return await resp.json();
        }
        if (resp.status !== 403) {
            logger.error('Convo failure:', await resp.text());
            throw new Error('Conversation API Error');
        }
    };

    ns.login = async function() {
        if (_loginUsed) {
            throw TypeError("login is not idempotent");
        } else {
            _loginUsed = true;
        }
        const login = !useJwtProxy ? _login : _loginJwtProxy;
        try {
            await login();
        } catch(e) {
            logger.error("Login issue:", e);
            await F.util.confirmModal({
                header: 'Signin Failure',
                icon: 'warning sign yellow',
                content: 'A problem occured while establishing a session...<pre>' + e + '</pre>',
                confirm: !useJwtProxy,
                confirmLabel: 'Sign out',
                confirmIcon: 'sign out',
                dismiss: false,
                closable: false
            });
            if (!useJwtProxy) {
                location.assign(F.urls.signin);
            }
            await F.never();
        }
    };

    ns.workerLogin = async function(id) {
        if (_loginUsed) {
            throw TypeError("login is not idempotent");
        } else {
            _loginUsed = true;
        }
        await setCurrentUser(id);
        const config = await relay.hub.getAtlasConfig();
        if (!config) {
            await self.registration.unregister();
            throw new ReferenceError("Worker Login Failed: No Atlas config found");
        }
    };

    ns.ephemeralLogin = async function(params) {
        if (_loginUsed) {
            throw TypeError("login is not idempotent");
        } else {
            _loginUsed = true;
        }
        ns.signout = function() {
            throw new Error("Signout Blocked");
        };
        const hashKeys = ['token', 'first_name', 'last_name', 'email', 'phone', 'salt'];
        const hash = md5(JSON.stringify(hashKeys.map(x => params.get(x))));
        let userData = getEphemeralUserData(hash);
        if (!userData) {
            logger.warn("Creating new ephemeral user");
            userData = await createEphemeralUser(params);
            setEphemeralUserData(hash, userData);
            await ns.saveAuth(userData.jwt, {skipLocal: true});
        } else {
            logger.warn("Reusing existing ephemeral user");
            const authToken = relay.hub.decodeAtlasToken(userData.jwt);
            await setCurrentUser(authToken.payload.user_id);
        }
    };

    ns.chatLogin = async function(token, params) {
        if (_loginUsed) {
            throw TypeError("login is not idempotent");
        } else {
            _loginUsed = true;
        }
        let convo;
        const fullAuthToken = getLocalAuth();
        if (fullAuthToken) {
            await setCurrentUser(fullAuthToken.payload.user_id);
        } else {
            // Get or create ephemeral user..
            const hashKeys = ['first_name', 'last_name', 'email', 'phone', 'salt'];
            const hash = md5(token + JSON.stringify(hashKeys.map(x => params.get(x))));
            const userData = getEphemeralUserData(hash);
            if (!userData) {
                if (!params.has('first_name')) {
                    const data = await F.util.formModal({
                        header: 'Enter your name',
                        size: 'tiny',
                        fields: [{
                            label: 'What should people call you?',
                            name: 'name'
                        }]
                    });
                    if (data) {
                        params.set('first_name', data.name.split(/\s+/)[0]);
                        params.set('last_name', data.name.split(/\s+/).slice(1).join(' '));
                    }
                }
                logger.warn("Creating new chat user");
                convo = await joinConversation(token, params);
                setEphemeralUserData(hash, {
                    jwt: convo.jwt,
                    expire: new Date(convo.expires).getTime()
                });
                await ns.saveAuth(convo.jwt, {skipLocal: true});
            } else {
                const authToken = relay.hub.decodeAtlasToken(userData.jwt);
                await setCurrentUser(authToken.payload.user_id);
            }
        }
        if (!convo) {
            convo = await ns.getConversation(token);
            if (!convo) {
                logger.info("Joining conversation..");
                convo = await joinConversation(token, params);
            }
        }
        return {
            embed: !fullAuthToken,
            threadId: convo.thread_id,
            distribution: convo.distribution,
        };
    };

    ns.signout = async function() {
        F.currentUser = null;
        if (self.localStorage) {
            localStorage.removeItem(userConfigKey);
        }
        await relay.hub.setAtlasConfig(null);
        F.util.setIssueReportingContext();  // clear it
        if (location.assign) {
            if (!useJwtProxy) {
                location.assign(F.urls.signin);
            }
        } else {
            /* We're a service worker, just post a quick note and unregister. */
            await F.notifications.show('Forsta Messenger Signout', {
                body: 'Your session has ended.',
                silent: true
            });
            await self.registration.unregister();
        }
        await F.never();
    };

    ns.saveAuth = async function(encodedToken, options) {
        // This looks crazy because it is. For compat with the admin ui save a django
        // rest framework style object in localstorage...
        options = options || {};
        const config = {
            API: {
                TOKEN: encodedToken,
                URLS: {
                    BASE: F.env.ATLAS_URL,
                    WS_BASE: F.env.ATLAS_URL.replace(/^http/, 'ws')
                }
            }
        };
        const token = relay.hub.decodeAtlasToken(encodedToken);
        const id = token.payload.user_id;
        F.Database.setId(id);
        await relay.hub.setAtlasConfig(config);
        if (!options.skipLocal) {
            setLocalConfig(config);
        }
        await setCurrentUser(id);
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
                if (resp.next) {
                    logger.error(!resp.next, 'paging not implemented yet');
                }
                if (!ids.has(data.id)) {
                    ids.add(data.id);
                    results.push(new F.Contact(data));
                }
            }
        }
        return results;
    };

    ns.getUsersFromCache = F.cache.ttl(86400, relay.hub.getUsers);

    let _usersCacheReadonly;
    const _invalidContacts = new Set();
    ns.getContacts = async function(userIds) {
        if (_usersCacheReadonly === undefined) {
            _usersCacheReadonly = ns.getUsersFromCache.store.constructor.isReadonly();
        }
        const missing = [];
        const contacts = {};
        const contactsCol = F.foundation.getContacts();
        for (const id of userIds) {
            const c = contactsCol.get(id);
            if (c) {
                contacts[id] = c;
            } else {
                missing.push(id);
            }
        }
        if (missing.length) {
            await Promise.all((await ns.getUsersFromCache(missing, /*onlyDir*/ true)).map(async (attrs, i) => {
                if (attrs) {
                    const c = new F.Contact(attrs);
                    if (!_usersCacheReadonly) {
                        await c.save();
                    }
                    contactsCol.add(c, {merge: true});
                    contacts[attrs.id] = c;
                } else if (!_invalidContacts.has(missing[i])) {
                    // Only log once.
                    _invalidContacts.add(missing[i]);
                    logger.debug("Invalid userid:", missing[i]);
                }
            }));
        }
        // Return in same order..
        return userIds.map(id => contacts[id]);
    };

    ns.getContact = async function(userId) {
        return (await ns.getContacts([userId]))[0];
    };

    ns.getTagFromCache = F.cache.ttl(86400, async function(tagId) {
        if (!tagId) {
            throw TypeError("tagId required");
        }
        try {
            return await relay.hub.fetchAtlas(`/v1/tag/${tagId}/`);
        } catch(e) {
            if (!(e instanceof ReferenceError)) {
                throw e;
            }
        }
    });

    ns.getTag = async function(tagIdOrSlug) {
        let tagId;
        tagIdOrSlug = tagIdOrSlug.trim();
        if (!F.util.isUUID(tagIdOrSlug)) {
            const expr = await ns.resolveTagsFromCache(relay.hub.sanitizeTags(tagIdOrSlug));
            tagId = expr.includedTagids[0];
        } else {
            tagId = tagIdOrSlug;
        }
        if (!tagId) {
            logger.warn("Invalid tag:", tagIdOrSlug);
            return;
        }
        // XXX Eventually tie in with foundation.getTags() collection.
        return new F.Tag(await ns.getTagFromCache(tagId));
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
            logger.warn("Org not found:", id);
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
            await F.sleep(throttle);
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
        for (const x of expressions) {
            if (!x || typeof x !== 'string') {
                throw TypeError(`Invalid expression: ${x}`);
            }
        }
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
                        logger.warn("Returning expired cache entry while offline:", expr);
                        return e.value;
                    } else if (!(e instanceof F.cache.CacheMiss)) {
                        throw e;
                    }
                }
                if (hit) {
                    if (hit.expiration - Date.now() < tagsCacheTTLMax - tagsCacheTTLRefresh) {
                        // Reduce potential cache miss in future with background refresh now.
                        logger.debug("Background refresh of tag expr", expr);
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

    ns.getRTCServersFromCache = async () => await ns.fetchFromCache(3600 * 8, '/v1/rtc/servers/');
})();
