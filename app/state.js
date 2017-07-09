// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.state = {};

    ns.put = async function(key, value) {
        if (value === undefined) {
            throw new Error("Tried to store undefined");
        }
        const model = new F.State({key, value});
        await model.save();
    };

    ns.putDict = async function(dict) {
        const models = Object.entries(dict).map(x => new F.State({key: x[0], value: x[1]}));
        await Promise.all(models.map(m => m.save()));
    };

    ns.get = async function(key, defaultValue) {
        const model = new F.State({key});
        try {
            await model.fetch();
        } catch(e) {
            if (e.message !== 'Not Found') {
                throw e;
            }
            return defaultValue;
        }
        return model.get('value');
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
        const model = new F.State({key});
        await model.destroy();
    };
})();
