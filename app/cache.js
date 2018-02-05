// vim: ts=4:sw=4:expandtab
/* global md5 Backbone */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.cache = {};
    const _stores = [];
    let _dbReady;

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
    ns.CacheMiss = CacheMiss;

    class CacheStore {
        constructor(ttl, bucketLabel, options) {
            options = options || {};
            if (ttl === undefined) {
                throw new TypeError("`ttl` required");
            }
            if (!bucketLabel) {
                throw new TypeError("`bucketLabel` required");
            }
            this.ttl = ttl;
            this.bucket = md5(bucketLabel);
            this.jitter = options.jitter === undefined ? 0.20 : options.jitter;
            if (this.jitter < 0 || this.jitter > 1) {
                throw new TypeError("`options.jitter` must be >= 0 and <= 1");
            }
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

        flush() {
        }
    }

    class MemoryCacheStore extends CacheStore {
        constructor(ttl, bucketLabel, options) {
            super(ttl, bucketLabel, options);
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

        flush() {
            this.cache = new Map();
        }
    }

    class DatabaseCacheStore extends CacheStore {
        constructor(ttl, bucketLabel, options) {
            super(ttl, bucketLabel, options);
            this.recent = new CacheCollection([], {bucket: this.bucket});
            this.gc_interval = 10;  // Only do full GC scan every N expirations.
            this.expire_count = 0;
        }

        fullKey(key) {
            return this.bucket + '-' + key;
        }

        async get(key) {
            if (!_dbReady) {
                console.warn("DB unready: cache bypassed");
                throw new CacheMiss(key);
            }
            const fullKey = this.fullKey(key);
            let hit;
            const recentHit = hit = this.recent.get(fullKey);
            if (!recentHit) {
                hit = new CacheModel({key: fullKey, bucket: this.bucket});
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
            if (!_dbReady) {
                console.warn("DB unready: cache disabled");
                return;
            }
            await this.recent.add({
                bucket: this.bucket,
                expiration: this.expiry(),
                key: this.fullKey(key),
                value
            }, {merge: true}).save();
        }

        flush() {
            this.recent.reset();
        }
    }

    const ttlCacheBackingStores = {
        memory: MemoryCacheStore,
        db: DatabaseCacheStore
    };

    ns.getTTLStore = function(ttl, bucketLabel, options) {
        options = options || {};
        const Store = ttlCacheBackingStores[options.store || 'db'];
        if (!Store) {
            throw new TypeError("Invalid store option");
        }
        const store = new Store(ttl, bucketLabel, options);
        _stores.push(store);
        return store;
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
        const bucketLabel = func.toString() + ttl + JSON.stringify(options);
        const store = ns.getTTLStore(ttl, bucketLabel, options);
        return async function wrap() {
            const key = md5(JSON.stringify(arguments));
            const scope = this;
            const args = arguments;
            return await F.queueAsync('cache' + bucketLabel + key, async function() {
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

    ns.flushAll = async function() {
        if (!_dbReady) {
            throw new TypeError("Cannot flush unready DB");
        }
        const db = await F.util.idbRequest(indexedDB.open(F.Database.id));
        try {
            const t = db.transaction('cache', 'readwrite');
            let store;
            try {
                store = t.objectStore('cache');
            } catch(e) {
                console.warn(e);
                return;
            }
            await F.util.idbRequest(store.clear());
            await Promise.all(_stores.map(x => x.flush()));
        } finally {
            db.close();
        }
    };

    ns.validate = async function() {
        if (!_dbReady) {
            throw new TypeError("Cannot validate unready DB");
        }
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

    self.addEventListener('dbready', async () => {
        _dbReady = true;
        await ns.validate();
    });
    self.addEventListener('dbversionchange', () => _dbReady = false);
})();
