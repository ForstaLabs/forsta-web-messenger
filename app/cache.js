// vim: ts=4:sw=4:expandtab
/* global md5 Backbone */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.cache = {};
    const _stores = [];

    const CacheModel = Backbone.Model.extend({
        database: F.Database,
        storeName: 'cache',
        idAttribute: 'key',

        age: function() {
            return (Date.now() - this.get('expiration')) / 1000;
        },

        expired: function() {
            return Date.now() > this.get('expiration');
        }
    });

    const CacheCollection = Backbone.Collection.extend({
        model: CacheModel,
        database: F.Database,
        storeName: 'cache',

        initialize: function(initial, options) {
            this.bucket = options.bucket;
        },

        fetchExpired: async function() {
            await this.fetch({
                index: {
                    name: 'bucket-expiration',
                    lower: [this.bucket, Date.now()]
                }
            });
        }
    });

    class CacheMiss extends Error {}

    class CacheStore {
        constructor(ttl, bucket, jitter) {
            this.ttl = ttl;
            this.bucket = bucket;
            this.jitter = jitter || 1;
        }

        get(key) {
            /* Return hit value or throw CacheMiss if not present or stale. */
            throw new Error("Implementation required");
        }

        set(key, value) {
            throw new Error("Implementation required");
        }

        expiry() {
            /* Jiterized expiration timestamp */
            const skew = 1 + (Math.random() * this.jitter) - (this.jitter / 2);
            return Date.now() + (this.ttl * skew);
        }
    }

    class MemoryCacheStore extends CacheStore {
        constructor(ttl, bucket, jitter) {
            super(ttl, bucket, jitter);
            this.cache = new Map();
        }

        get(key) {
            if (this.cache.has(key)) {
                const hit = this.cache.get(key);
                if (Date.now() <= hit.expiration) {
                    return hit.value;
                } else {
                    this.cache.delete(key);
                }
            }
            throw new CacheMiss(key);
        }

        set(key, value) {
            this.cache.set(key, {
                expiration: this.expiry(),
                value
            });
        }
    }

    class DatabaseCacheStore extends CacheStore {
        constructor(ttl, bucket, jitter) {
            super(ttl, bucket, jitter);
            this.recent = new CacheCollection([], {bucket});
            this.gc_interval = 10;  // Only do full GC scan every N expirations.
            this.expire_count = 0;
        }

        async get(key) {
            let hit;
            const recentHit = hit = this.recent.get(key);
            if (!recentHit) {
                hit = new CacheModel({key, bucket: this.bucket});
                try {
                    await hit.fetch();
                } catch(e) {
                    if (e.message !== 'Not Found') {
                        throw e;
                    } else {
                        throw new CacheMiss(key);
                    }
                }
            }
            if (!hit.expired()) {
                // Add to in-memory collection to speed up subsequent hits.
                if (!recentHit) {
                    this.recent.add(hit, {merge: true});
                }
                return hit.get('value');
            } else {
                this.expire_count++;
                await hit.destroy();
                if (this.expire_count % this.gc_interval === 0) {
                    await this.gc();
                }
                throw new CacheMiss(key);
            }
        }

        async gc() {
            /* Garbage collect expired entries from our bucket */
            const expired = new CacheCollection([], {bucket: this.bucket});
            await expired.fetchExpired();
            const removals = Array.from(expired.models);
            await Promise.all(removals.map(model => model.destroy()));
            this.recent.remove(removals);
        }

        async set(key, value) {
            await this.recent.add({
                bucket: this.bucket,
                expiration: this.expiry(),
                key,
                value
            }, {merge: true}).save();
        }
    }

    const ttlCacheBackingStores = {
        memory: MemoryCacheStore,
        db: DatabaseCacheStore
    };

    ns.ttl = function(expiration, func, options) {
        /* Wrap a static function with a basic Time-To-Live cache.  The `expiration`
         * argument controls how long cached entries should be used for future
         * requests.  The key for a cache lookup is based on the function
         * signature.
         *
         * NOTE: The function being wrapped should be static to avoid corruption.
         */
        options = options || {};
        const ttl = expiration * 1000;
        const Store = ttlCacheBackingStores[options.store || 'db'];
        if (!Store) {
            throw new TypeError("Invalid store option");
        }
        const bucket = md5(func.toString() + ttl + JSON.stringify(options));
        const store = new Store(ttl, bucket, options.jitter || 0.20);
        _stores.push(store);
        return async function wrap() {
            const key = md5(JSON.stringify(arguments));
            const scope = this;
            const args = arguments;
            return await F.queueAsync('cache' + bucket + key, async function() {
                try {
                    return await store.get(key);
                } catch(e) {
                    if (!(e instanceof CacheMiss)) {
                        throw e;
                    }
                }
                const value = await func.apply(scope, args);
                await store.set(key, value);
                return value;
            });
        };
    };

    async function promiseIdb(req) {
        const p = new Promise((resolve, reject) => {
            req.onsuccess = ev => resolve(ev.target.result);
            req.onerror = ev => reject(new Error(ev.target.errorCode));
        });
        return await p;
    }

    ns.flushAll = async function() {
        const db = await promiseIdb(indexedDB.open(F.Database.id));
        const t = db.transaction(db.objectStoreNames, 'readwrite');
        let store;
        try {
            store = t.objectStore('cache');
        } catch(e) {
            console.warn(e);
            return;
        }
        await promiseIdb(store.clear());
    };

    ns.validate = async function() {
        const targetCacheVersion = F.env.GIT_COMMIT;
        if (F.env.RESET_CACHE !== '1') {
            const currentCacheVersion = await F.state.get('cacheVersion');
            if (currentCacheVersion && currentCacheVersion === targetCacheVersion) {
                return;
            } else {
                console.warn("Flushing versioned-out cache");
            }
        } else {
            console.warn("Reseting cache (forced by env)");
        }
        await ns.flushAll();
        await F.state.put('cacheVersion', targetCacheVersion);
    };
})();
