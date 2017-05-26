/*
 * vim: ts=4:sw=4:expandtab
 */

;(function () {
    'use strict';

    window.F = window.F || {};
 
    if (window.crypto && !window.crypto.subtle && window.crypto.webkitSubtle) {
        window.crypto.subtle = window.crypto.webkitSubtle;
    }
})();
