/*
 * vim: ts=4:sw=4:expandtab
 */
(function() {
    'use strict';

    window.textsecure = window.textsecure || {};
    textsecure.storage = textsecure.storage || {};

    if (window.crypto && !window.crypto.subtle && window.crypto.webkitSubtle) {
        window.crypto.subtle = window.crypto.webkitSubtle;
    }

    textsecure.init = function(protocol_store) {
        textsecure.storage.protocol = protocol_store;
        textsecure.ProvisioningCipher = libsignal.ProvisioningCipher;
    };
})();
