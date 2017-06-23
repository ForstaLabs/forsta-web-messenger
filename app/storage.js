/*
 * vim: ts=4:sw=4:expandtab
 */
;(function() {
    'use strict';

    function encodeArrayBuffer(buf) {
        return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
    }

    function decodeArrayBuffer(str) {
        str = atob(str);
        const buf = new ArrayBuffer(str.length);
        var bufView = new Uint8Array(buf);
        for (let i = 0, len = str.length; i < len; i++) {
            bufView[i] = str.charCodeAt(i);
        }
        return buf;
    }

    self.storage = {
        put: function(key, value) {
            if (value === undefined) {
                throw new Error("Tried to store undefined");
            }
            let conv;
            if (value instanceof ArrayBuffer) {
                value = encodeArrayBuffer(value);
                conv = 'AB1';
            }
            localStorage.setItem(key, JSON.stringify({conv, value}));
        },

        get: function(key, defaultValue) {
            const raw = localStorage.getItem(key);
            if (raw === null) {
                return defaultValue;
            }
            const data = JSON.parse(raw);
            if (data.conv === 'AB1') {
                data.value = decodeArrayBuffer(data.value);
            }
            return data.value;
        },

        remove: localStorage.removeItem.bind(localStorage)
    };

    self.textsecure = self.textsecure || {};
    textsecure.storage = textsecure.storage || {};
    textsecure.storage.impl = self.storage;
})();
