/*
 * vim: ts=4:sw=4:expandtab
 */
;(function() {
    'use strict';

    window.times = {
        put: 0,
        get: 0,
        remove: 0
    }

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

    window.storage = {
        put: function(key, value) {
            const start = performance.now()
            if (value === undefined) {
                throw new Error("Tried to store undefined");
            }
            let conv;
            if (value instanceof ArrayBuffer) {
                value = encodeArrayBuffer(value);
                conv = 'AB1';
            }
            localStorage.setItem(key, JSON.stringify({conv, value}));
            times.put += performance.now() - start;
        },

        get: function(key, defaultValue) {
            const start = performance.now()
            const raw = localStorage.getItem(key);
            if (raw === null) {
                times.get += performance.now() - start;
                return defaultValue;
            }
            const data = JSON.parse(raw);
            if (data.conv === 'AB1') {
                data.value = decodeArrayBuffer(data.value);
            }
            times.get += performance.now() - start;
            return data.value;
        },

        remove: function(key) {
            const start = performance.now()
            localStorage.removeItem(key);
            times.remove += performance.now() - start;
        },

        onready: function(callback) {
            throw new Error("Don't use tis");
            callback();
        },

        fetch: async function() {
        }
    };

    window.textsecure = window.textsecure || {};
    window.textsecure.storage = window.textsecure.storage || {};
    window.textsecure.storage.impl = window.storage;
})();
