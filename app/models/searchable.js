// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function () {
    'use strict';

    self.F = self.F || {};

    F.SearchableModel = Backbone.Model.extend({
        /*
         * searchIndexes: [{
         *     length: 3,
         *     attr: 'someModelAttr',
         *     index: 'trigrams'
         * }],
         */

        save: async function() {
            if (this.searchIndexes) {
                for (const x of this.searchIndexes) {
                    // XXX Check if changed first..
                    const attr = this.get(x.attr) || '';
                    const ngrams = this.ngram(x.length, attr);
                    this.set(x.index, Array.from(ngrams), {silent: true});
                }
            }
            return Backbone.Model.prototype.save.apply(this, arguments);
        },

        ngram: function(n, value) {
            value = value.toLowerCase();
            const ngrams = new Set();
            for (let i = 0; i < value.length; i++) {
                const ngram = value.substr(i, n);
                if (ngram.length === n) {
                    ngrams.add(ngram);
                }
            }
            return ngrams;
        }
    });

    F.SearchableCollection = Backbone.Collection.extend({

        searchFetch: async function(criteria, options) {
            options = options || {};
            const limit = options.limit || 10;
            const db = await F.util.idbRequest(indexedDB.open(this.database.id));
            const tx = db.transaction(this.storeName);
            const modelProto = this.model.prototype;
            const store = tx.objectStore(this.storeName);
            const cursorRequests = [];
            for (const x of modelProto.searchIndexes) {
                for (const key of modelProto.ngram(x.length, criteria)) {
                    cursorRequests.push(store.index(x.index).openKeyCursor(key));
                }
            }
            const matchCounts = new Map();
            const requiredCount = cursorRequests.length; // Perhaps could be percentage of ngrams for more fuzz?
            const matches = new Set();
            await new Promise((resolve, reject) => {
                const activeRequests = new Set(cursorRequests);
                let done;
                for (const req of cursorRequests) {
                    req.onsuccess = ev => {
                        /* NOTE: this is an event callback for each match, not a one time deal! */
                        if (done) {
                            return;
                        }
                        const cursor = ev.target.result;
                        if (cursor) {
                            const pk = cursor.primaryKey;
                            matchCounts.set(pk, (matchCounts.get(pk) || 0) + 1);
                            if (matchCounts.get(pk) >= requiredCount) {
                                matches.add(pk);
                                if (limit && matches.size === limit) {
                                    done = true;
                                    resolve();  // No need to continue;
                                }
                            }
                            cursor.continue();
                        } else {
                            activeRequests.delete(req);
                            if (!activeRequests.size) {
                                resolve();  // Didn't reach limit.
                            }
                        }
                    };
                    req.onerror = ev => {
                        reject(new Error(ev.target.errorCode));
                    };
                }
            });
            const models = Array.from(matches).map(id => new this.model({id}));
            await Promise.all(models.map(m => m.fetch()));
            this.reset(models);
            return this;
        }
    });
})();
