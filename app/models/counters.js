// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.counters = {};

    const defaultPeriod = 7 * 86400 * 1000;  // one week granularity.

    function assertModel(model) {
        if (!(model instanceof Backbone.Model)) {
            throw new TypeError("Model instance required");
        }
    }

    /**
     * It's not imperitive to save immediately, so to keep impact low by
     * buffering and debounceing save requests for each counter.
     */
    const requestSave = F.buffered(async argsQueue => {
        const unique = new Set(argsQueue.map(x => x[0]));
        await Promise.all(Array.from(unique).map(x => x.save()));
    }, 200);


    F.Counter = Backbone.Model.extend({
        database: F.Database,
        storeName: 'counters'
    });

    F.CountersCollection = Backbone.Collection.extend({
        model: F.Counter,
        database: F.Database,
        storeName: 'counters',

        fetchByModel: async function(model) {
            assertModel(model);
            await this.fetch({
                index: {
                    name: 'model-fk-slot',
                    lower: [model.storeName, model.id],
                    upper: [model.storeName, model.id, Infinity]
                }
            });
        }
    });

    const countersCache = new F.CountersCollection();

    /**
     * Increment the counter for a model.
     * This is used for determining how often and recently a model has been
     * used.  E.g. How popular the model is.
     */
    ns.increment = async function(model, options) {
        assertModel(model);
        options = options || {};
        const period = options.period || defaultPeriod;
        const slot = Math.floor(Date.now() / period) * period;
        const criteria = {
            model: model.storeName,
            fk: model.id,
            slot
        };
        return await F.queueAsync(`counters-increment-${model.id}`, async () => {
            let counter = countersCache.findWhere(criteria);
            if (!counter) {
                counter = new F.Counter(criteria);
                try {
                    await counter.fetch();
                } catch(e) {
                    if (e instanceof ReferenceError) {
                        counter.set('count', 0);
                    }
                }
                countersCache.add(counter);
            }
            const count = counter.get('count') + 1;
            counter.set({count});
            requestSave(counter);
            return count;
        });
    };

    ns.fetchCounters = async function(model) {
        assertModel(model);
        const counters = new F.CountersCollection();
        await counters.fetchByModel(model);
        return counters;
    };

    ns.getTotal = async function(model) {
        assertModel(model);
        const counters = await ns.fetchCounters(model);
        return counters.reduce((agg, x) => agg + x.get('count'), 0);
    };

    ns.getAgeWeightedTotal = async function(model, options) {
        assertModel(model);
        options = options || {};
        const period = options.period || defaultPeriod;
        const rolloff = options.rolloff || 0.5;  // Halve slot count for each period step.
        const counters = await ns.fetchCounters(model);
        const now = Date.now();
        return counters.reduce((agg, x) => {
            const steps = Math.floor((now - x.get('slot')) / period);
            return agg + (x.get('count') * (rolloff ** steps));
        }, 0);
    };
})();
