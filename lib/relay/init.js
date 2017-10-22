// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    const ns = self.relay = self.relay || {};

    let _initialized;
    ns.init = async function(store) {
        if (_initialized) {
            return;
        }
        await ns.protobuf.load();
        ns.store = store;
        _initialized = true;
    };
})();
