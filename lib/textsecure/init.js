/*
 * vim: ts=4:sw=4:expandtab
 */
(function() {
    'use strict';

    self.textsecure = self.textsecure || {};

    if (self.crypto && !self.crypto.subtle && self.crypto.webkitSubtle) {
        self.crypto.subtle = self.crypto.webkitSubtle;
    }

    let _initialized;
    textsecure.init = async function(store) {
        if (_initialized) {
            return;
        }
        await textsecure.protobuf.load();
        textsecure.ProvisioningCipher = libsignal.ProvisioningCipher;
        textsecure.store = store;
        _initialized = true;
    };
})();
