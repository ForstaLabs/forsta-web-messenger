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
            const limit = options.limit || 20;
            const db = await F.util.idbRequest(indexedDB.open(this.database.id));
            const tx = db.transaction(this.storeName);
            const modelProto = this.model.prototype;
            const store = tx.objectStore(this.storeName);
            let dataRequest;
            const keyRequests = [];
            for (const x of modelProto.searchIndexes) {
                for (const key of modelProto.ngram(x.length, criteria)) {
                    if (!dataRequest) {
                        dataRequest = store.index(x.index).getAll(key);
                    } else {
                        keyRequests.push(store.index(x.index).getAllKeys(key));
                    }
                }
            }
            if (!dataRequest) {
                this.reset();
                return this;
            }
            const matchCounts = new Map();
            let remaining = keyRequests.length + 1;
            let records;
            await new Promise((resolve, reject) => {
                dataRequest.onsuccess = ev => {
                    records = ev.target.result;
                    for (const record of records) {
                        const pk = record.id;
                        matchCounts.set(pk, (matchCounts.get(pk) || 0) + 1);
                    }
                    if (!--remaining) {
                        resolve();
                    }
                };
                dataRequest.onerror = ev => {
                    reject(new Error(ev.target.errorCode));
                };
                for (const req of keyRequests) {
                    req.onsuccess = ev => {
                        for (const pk of ev.target.result) {
                            matchCounts.set(pk, (matchCounts.get(pk) || 0) + 1);
                        }
                        if (!--remaining) {
                            resolve();
                        }
                    };
                    req.onerror = ev => {
                        reject(new Error(ev.target.errorCode));
                    };
                }
            });
            const requiredCount = keyRequests.length + 1; // ??? tunable?
            records = records.filter(x => matchCounts.get(x.id) >= requiredCount);
            records.sort((a, b) => (b.sent || 0) - (a.sent || 0));
            this.reset(records.slice(0, limit).map(x => new this.model(x)));
            return this;
        }
    });
})();
