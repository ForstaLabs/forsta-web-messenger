// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.state = {};
    const cache = new Map();

    ns.put = async function(key, value) {
        const entry = new F.State({key, value});
        cache.set(key, value);
        try {
            await entry.save();
        } catch(e) {
            cache.delete(key);
            throw e;
        }
    };

    ns.putDict = async function(dict) {
        const saves = [];
        for (const x of Object.entries(dict)) {
            cache.set(x[0], x[1]);
            const entry = new F.State({key: x[0], value: x[1]});
            saves.push(entry.save().catch(() => cache.delete(x[0])));
        }
        await Promise.all(saves);
    };

    ns.get = async function(key, defaultValue) {
        if (cache.has(key)) {
            return cache.get(key);
        }
        const entry = new F.State({key});
        try {
            await entry.fetch();
        } catch(e) {
            if (e.message !== 'Not Found') {
                throw e;
            } else {
                return defaultValue;
            }
        }
        const value = entry.get('value');
        cache.set(key, value);
        return value;
    };

    ns.getDict = async function(keys) {
        const models = keys.map(key => new F.State({key}));
        await Promise.all(models.map(m => m.fetch({not_found_error: false})));
        const dict = {};
        for (let i = 0; i < keys.length; i++) {
            dict[keys[i]] = models[i].get('value');
        }
        return dict;
    };

    ns.remove = async function(key) {
        const entry = new F.State({key});
        await entry.destroy();
        cache.delete(key);
    };
})();
