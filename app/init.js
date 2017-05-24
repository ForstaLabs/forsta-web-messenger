/*
 * vim: ts=4:sw=4:expandtab
 */

;(function () {
    'use strict';

    window.Forsta = window.Forsta || {};
 
    if (window.crypto && !window.crypto.subtle && window.crypto.webkitSubtle) {
        window.crypto.subtle = window.crypto.webkitSubtle;
    }
})();
