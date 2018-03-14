// vim: ts=4:sw=4:expandtab
/* global */

(function() {
    'use strict';
 
    function onLoad() {
        // Monkey patch default duration of all modals to be faster (default is 500).
        $.fn.modal.settings.duration = 250;
    }

    addEventListener('load', onLoad);
})();
