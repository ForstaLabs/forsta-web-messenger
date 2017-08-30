// vim: ts=4:sw=4:expandtab
/* global md5 */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.cache = {};

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
                        console.warn("L2 Cache Miss:", key);
                        throw new CacheMiss(key);
                    }
                }
                console.info("L2 Cache HIT:", key);
            } else {
                console.info("L1 Cache HIT:", key);
            }
            if (!hit.expired()) {
                // Add to in-memory collection to speed up subsequent hits.
                if (!recentHit) {
                    this.recent.add(hit, {merge: true});
                }
                return hit.get('value');
            } else {
                this.expire_count++;
                //await hit.destroy();
                //if (this.expire_count % this.gc_interval === 0) {
                //    await this.gc(); // background okay..
                //}
                console.warn("Cache Expire:", key, hit.age());
                throw new CacheMiss(key);
            }
        }

        async gc() {
            /* Garbage collect expired entries from our bucket */
            console.warn("GC", this.expire_count);
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
