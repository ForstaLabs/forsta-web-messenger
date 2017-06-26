/*
 * vim: ts=4:sw=4:expandtab
 */
(function() {
    'use strict';

    window.textsecure = window.textsecure || {};
    textsecure.storage = textsecure.storage || {};
    let _initialized;

    if (window.crypto && !window.crypto.subtle && window.crypto.webkitSubtle) {
        window.crypto.subtle = window.crypto.webkitSubtle;
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
