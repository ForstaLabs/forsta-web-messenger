/*
 * vim: ts=4:sw=4:expandtab
 */
(function() {
    'use strict';

    self.textsecure = self.textsecure || {};
    textsecure.storage = textsecure.storage || {};
    let _initialized;

    if (self.crypto && !self.crypto.subtle && self.crypto.webkitSubtle) {
        self.crypto.subtle = self.crypto.webkitSubtle;
    }

    textsecure.init = async function(protocol_store) {
        if (_initialized) {
            return;
        }
        await textsecure.protobuf.load();
        textsecure.storage.protocol = protocol_store;
        textsecure.ProvisioningCipher = libsignal.ProvisioningCipher;
        _initialized = true;
    };
})();
