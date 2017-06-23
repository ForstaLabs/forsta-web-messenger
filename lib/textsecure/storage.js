/*
 * vim: ts=4:sw=4:expandtab
 */

'use strict';

;(function() {

    /************************************************
    *** Utilities to store data in local storage ***
    ************************************************/
    self.textsecure = self.textsecure || {};
    self.textsecure.storage = self.textsecure.storage || {};

    // Overrideable storage implementation
    self.textsecure.storage.impl = self.textsecure.storage.impl || {
        /*****************************
        *** Base Storage Routines ***
        *****************************/
        put: function(key, value) {
            if (value === undefined)
                throw new Error("Tried to store undefined");
            localStorage.setItem("" + key, textsecure.utils.jsonThing(value));
        },

        get: function(key, defaultValue) {
            var value = localStorage.getItem("" + key);
            if (value === null)
                return defaultValue;
            return JSON.parse(value);
        },

        remove: function(key) {
            localStorage.removeItem("" + key);
        },
    };

    self.textsecure.storage.put = function(key, value) {
        return textsecure.storage.impl.put(key, value);
    };

    self.textsecure.storage.get = function(key, defaultValue) {
        return textsecure.storage.impl.get(key, defaultValue);
    };

    self.textsecure.storage.remove = function(key) {
        return textsecure.storage.impl.remove(key);
    };
})();

