// vim: ts=4:sw=4:expandtab
/* global md5 Backbone */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.cache = {};
    let _userDatabaseReady;
    let _sharedDatabaseReady;

    const CacheModel = Backbone.Model.extend({
        storeName: 'cache',
        idAttribute: 'key',

        age: function() {
            return (Date.now() - this.get('expiration')) / 1000;
        },

        expired: function() {
            return Date.now() > this.get('expiration');
        }
    });

    const UserCacheModel = CacheModel.extend({
        database: F.Database,
    });

    const SharedCacheModel = CacheModel.extend({
        database: F.SharedCacheDatabase
    });

    const CacheCollection = Backbone.Collection.extend({
        storeName: 'cache',

        initialize: function(initial, options) {
            this.bucket = options.bucket;
        },

        fetchExpired: async function() {
            await this.fetch({
                index: {
                    name: 'bucket-expiration',
                    lower: [this.bucket],
                    upper: [this.bucket, Date.now()]
                }
            });
        }
    });

    const UserCacheCollection = CacheCollection.extend({
        model: UserCacheModel,
        database: F.Database,
    });

    const SharedCacheCollection = CacheCollection.extend({
        model: SharedCacheModel,
        database: F.SharedCacheDatabase
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
            this.recent = this.makeCacheCollection();
            this._useCount = 0;
            this._hitCount = 0;
            this._missCount = 0;
            this.gcInterval = 100;  // Only do garbage collection every N uses.
            this.constructor.register(this);
        }

        static register(store) {
            if (!this._stores) {
                this._stores = [];
            }
            this._stores.push(store);
        }

        static getStores() {
            return this._stores || [];
        }

        makeCacheModel(options) {
            // Must return new instance of CacheModel
            throw new Error("Not Implemented");
        }

        makeCacheCollection() {
            // Must return new instance of CacheCollection for this bucket
            throw new Error("Not Implemented");
        }

        static ready() {
            throw new Error("not implemented");
        }

        static async getDatabase() {
            throw new Error("not implemented");
        }

        fullKey(key) {
            return this.bucket + '-' + md5(key);
        }

        async get(key) {
            if (!this.constructor.ready()) {
                console.warn("DB unready: cache bypassed");
                this._missCount++;
                throw new CacheMiss(key);
            }
            if (this._useCount++ % this.gcInterval === 0) {
                await this.gc();
            }
            const fullKey = this.fullKey(key);
            let hit;
            const recentHit = hit = this.recent.get(fullKey);
            if (!recentHit) {
                hit = this.makeCacheModel({key: fullKey, bucket: this.bucket});
                try {
                    await hit.fetch();
                } catch(e) {
                    if (e instanceof ReferenceError) {
                        this._missCount++;
                        throw new CacheMiss(key);
                    } else {
                        throw e;
                    }
                }
            }
            if (!hit.expired()) {
                this._hitCount++;
                // Add to in-memory collection to speed up subsequent hits.
                if (!recentHit) {
                    this.recent.add(hit, {merge: true});
                }
                return hit.get('value');
            } else {
                await hit.destroy();
                this._missCount++;
                throw new CacheMiss(key);
            }
        }

        async gc() {
            /* Garbage collect expired entries from our bucket */
            const expired = this.makeCacheCollection();
            await expired.fetchExpired();
            const removals = Array.from(expired.models);
            await Promise.all(removals.map(model => model.destroy()));
            this.recent.remove(removals);
            console.debug(`Cache GC [${this.bucket}]: Removed ${removals.length} expired entries ` +
                          `(${this._hitCount} hits, ${this._missCount} misses)`);
        }

        async set(key, value) {
            if (!this.constructor.ready()) {
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

        static async purge() {
            const db = await this.getDatabase();
            console.warn("Purging:", db.name);
            try {
                let store;
                try {
                    store = db.transaction('cache', 'readwrite').objectStore('cache');
                } catch(e) {
                    console.warn(e);
                    return;
                }
                await F.util.idbRequest(store.clear());
            } finally {
                db.close();
            }
            await Promise.all(this.getStores().map(x => x.flush()));
        }
    }

    class UserDatabaseCacheStore extends DatabaseCacheStore {
        makeCacheModel(options) {
            return new UserCacheModel(options);
        }

        makeCacheCollection() {
            return new UserCacheCollection([], {bucket: this.bucket});
        }

        static ready() {
            return _userDatabaseReady;
        }

        static async getDatabase() {
            return await F.util.idbRequest(indexedDB.open(F.Database.id));
        }

        static async validate() {
            if (!this.ready()) {
                throw new TypeError("Cannot validate unready DB");
            }
            const targetCacheVersion = F.env.GIT_COMMIT;
            if (F.env.RESET_CACHE !== '1') {
                const currentCacheVersion = await F.state.get('cacheVersion');
                if (currentCacheVersion && currentCacheVersion === targetCacheVersion) {
                    return;
                } else {
                    console.warn("Flushing versioned-out user cache");
                }
            } else {
                console.warn("Reseting user cache (forced by env)");
            }
            await this.purge();
            await F.state.put('cacheVersion', targetCacheVersion);
        }
    }

    class SharedDatabaseCacheStore extends DatabaseCacheStore {
        makeCacheModel(options) {
            return new SharedCacheModel(options);
        }

        makeCacheCollection() {
            return new SharedCacheCollection([], {bucket: this.bucket});
        }

        static ready() {
            return _sharedDatabaseReady;
        }

        static async getDatabase() {
            return await F.util.idbRequest(indexedDB.open(F.SharedCacheDatabase.id));
        }

        static async validate() {
            if (!this.ready()) {
                throw new TypeError("Cannot validate unready DB");
            }
            if (F.env.RESET_CACHE === '1') {
                console.warn("Reseting shared cache (forced by env)");
                await this.purge();
            }
        }
    }

    const ttlCacheBackingStores = {
        memory: MemoryCacheStore,
        user_db: UserDatabaseCacheStore,
        shared_db: SharedDatabaseCacheStore
    };

    ns.getTTLStore = function(ttl, bucketLabel, options) {
        options = options || {};
        const Store = ttlCacheBackingStores[options.store || 'user_db'];
        if (!Store) {
            throw new TypeError("Invalid store option");
        }
        return new Store(ttl, bucketLabel, options);
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
            const key = JSON.stringify(arguments);
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
        await UserDatabaseCacheStore.purge();
        await SharedDatabaseCacheStore.purge();
    };

    ns.startSharedCache = async function() {
        /* Wakeup the shared cache database by fetching a bogus model. */
        const init = new SharedCacheModel();
        try {
            await init.fetch();
        } catch(e) {
            if (!(e instanceof ReferenceError)) {
                throw e;
            }
        }
    };

    self.addEventListener('dbready', async ev => {
        if (ev.db.name === F.Database.id) {
            _userDatabaseReady = true;
            await UserDatabaseCacheStore.validate();
        } else if (ev.db.name === F.SharedCacheDatabase.id) {
            _sharedDatabaseReady = true;
            await SharedDatabaseCacheStore.validate();
        }
    });
    self.addEventListener('dbversionchange', () => _userDatabaseReady = false);
})();
