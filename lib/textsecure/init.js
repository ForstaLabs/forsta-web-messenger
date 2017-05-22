/*
 * vim: ts=4:sw=4:expandtab
 */
(function() {
    'use strict';
    window.textsecure = window.textsecure || {};
    window.textsecure.storage = window.textsecure.storage || {};
    textsecure.init = function(protocol_store) {
        textsecure.storage.protocol = protocol_store;
        textsecure.ProvisioningCipher = libsignal.ProvisioningCipher;
    };
})();
