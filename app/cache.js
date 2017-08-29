// vim: ts=4:sw=4:expandtab
/* global md5 */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.cache = {};

    const CacheModel = Backbone.Model.extend({
        database: F.Database,
        storeName: 'cache',
        idAttribute: 'key'
    });

    const CacheCollection = Backbone.Collection.extend({
        model: CacheModel,
        database: F.Database,
        storeName: 'cache',

        initialize: function(options) {
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
        get(key) {
            /* Return hit value or throw CacheMiss if not present or stale. */
            throw new Error("Implementation required");
        }

        set(key, value) {
            throw new Error("Implementation required");
        }
    }

    class MemoryCacheStore extends CacheStore {
        constructor(ttl, bucket, jitter) {
            super();
            this.ttl = ttl;
            this.jitter = jitter;
            this.cache = new Map();
        }

        get(key) {
            if (this.cache.has(key)) {
                const hit = this.cache.get(key);
                if (Date.now() - hit.timestamp < this.ttl) {
                    return hit.value;
                } else {
                    this.cache.delete(key);
                    // TODO: Maybe GC entire cache at this point?
                }
            }
            throw new CacheMiss(key);
        }

        set(key, value) {
            this.cache.set(key, {
                timestamp: Date.now(),
                value
            });
        }
    }

    class DatabaseCacheStore extends CacheStore {
        constructor(ttl, bucket, jitter) {
            super();
            this.ttl = ttl;
            this.jitter = jitter;
            this.bucket = bucket;
            this.recent = new CacheCollection({bucket});
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
            if (hit.get('expiration') >= Date.now()) {
                this.expire_count++;
                await hit.destroy();
                if (this.expire_count % this.gc_interval === 0) {
                    this.gc(); // background okay..
                }
                throw new CacheMiss(key);
            } else {
                // Add to in-memory collection to speed up subsequent hits.
                if (!recentHit) {
                    this.recent.add(hit, {merge: true});
                }
                return hit.get('value');
            }
        }

        async gc() {
            /* Garbage collect expired entries from our bucket */
            console.warn("GC", this.expire_count);
            const expired = new CacheCollection({bucket: this.bucket});
            await expired.fetchExpired();
            const removals = Array.from(expired.models);
            await Promise.all(removals.map(model => model.destroy()));
            this.recent.remove(removals);
        }

        async set(key, value) {
            const skew = this.jitter ? 1 + (Math.random() * this.jitter) - (this.jitter / 2) : 1;
            await this.recent.add({
                bucket: this.bucket,
                expiration: Date.now() + Math.round(this.ttl * skew),
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
        if (!func.name) {
            throw new ReferenceError("Cached functions must be named to identify cache bucket");
        }
        const bucket = md5(func.toString() + ttl + JSON.stringify(options));
        const store = new Store(ttl, bucket, options.jitter || 0.20);
        return async function wrap() {
            const key = md5(JSON.stringify(arguments));
            try {
                return await store.get(key);
            } catch(e) {
                if (!(e instanceof CacheMiss)) {
                    throw e;
                }
            }
            const value = await func.apply(this, arguments);
            await store.set(key, value);
            return value;
        };
    };
})();
