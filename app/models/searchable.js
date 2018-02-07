// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function () {
    'use strict';

    self.F = self.F || {};

    F.SearchableModel = Backbone.Model.extend({
        /*
         * searchIndexes: [{
         *     length: 3,              // Letter length of ngram
         *     attr: 'someModelAttr',  // Model attribute or callback function to index.
         *     index: 'trigrams',      // The indexeddb index name
         *     column: 'trigrams'      // Where to store the index data on the model
         * }],
         */

        save: async function() {
            if (this.searchIndexes) {
                for (const x of this.searchIndexes) {
                    // XXX Check if changed first..
                    let attr;
                    if (typeof x.attr === 'function') {
                        attr = await x.attr(this);
                    } else {
                        attr = this.get(x.attr);
                    }
                    const ngrams = this.ngram(x.length, attr, /*forcePad*/ true);
                    this.set(x.column, Array.from(ngrams), {silent: true});
                }
            }
            return Backbone.Model.prototype.save.apply(this, arguments);
        },

        ngram: function(n, value, forcePad) {
            if (!value) {
                return new Set();
            }
            const pad = ' ';
            if (forcePad) {
                value = pad + value + pad;
            }
            value = value.toLowerCase().replace(/\s+/g, pad);
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
            const modelProto = this.model.prototype;
            if (typeof criteria === 'string') {
                const defaults = modelProto.searchIndexes.filter(x => x.default);
                let index;
                if (defaults.length) {
                    if (defaults.length > 1) {
                        console.warn("More than one default index found!");
                    }
                    index = defaults[0].index;
                } else {
                    console.warn("No default index specified for:", modelProto);
                    index = modelProto.searchIndexes[0].index;
                }
                criteria = [{
                    index,
                    criteria
                }];
            }
            options = options || {};
            const limit = options.limit || 20;
            const db = await F.util.idbRequest(indexedDB.open(this.database.id));
            const tx = db.transaction(this.storeName);
            const store = tx.objectStore(this.storeName);
            let dataRequest;
            const keyRequests = [];
            for (const cSpec of criteria) {
                const sSpec = modelProto.searchIndexes.filter(x => x.index === cSpec.index)[0];
                if (!sSpec) {
                    throw TypeError("Invalid index specified in search criteria:", cSpec.index);
                }
                for (const key of modelProto.ngram(sSpec.length, cSpec.criteria)) {
                    if (!dataRequest) {
                        dataRequest = store.index(sSpec.index).getAll(key);
                    } else {
                        keyRequests.push(store.index(sSpec.index).getAllKeys(key));
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
