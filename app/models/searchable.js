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
            const jobs = modelProto.searchIndexes.map(x => ({
                ngrams: modelProto.ngram(x.length, criteria),
                index: store.index(x.index)
            }));
            const cursors = new Set();
            for (const job of jobs) {
                for (const ngram of job.ngrams) {
                    cursors.add(job.index.openKeyCursor(ngram));
                }
            }
            const matchCounts = new Map();
            const requiredCount = cursors.size; // Perhaps could be percentage of ngrams for more fuzz?
            const matches = new Set();
            while (cursors.size && matches.size < limit) {
                for (const cursor of cursors) {
                    const match = await F.util.idbRequest(cursor);
                    if (match) {
                        const pk = match.primaryKey;
                        matchCounts.set(pk, (matchCounts.get(pk) || 0) + 1);
                        if (matchCounts.get(pk) >= requiredCount) {
                            matches.add(pk);
                        }
                        match.continue();
                    } else {
                        cursors.delete(cursor);
                    }
                }
            }
            const models = Array.from(matches).map(id => new this.model({id}));
            await Promise.all(models.map(m => m.fetch()));
            this.reset(models);
            return this;
        }
    });
})();
