// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.discover = {};

    ns.searchGoogleContacts = function() {
        jQuery.ajax({
            url: 'https://apis.google.com/js/api.js',
            dataType: 'script',
            cache: true
        }).then(() => (async () => {
            /* NOTE: Must be nested inside inner non-async func to make jquery happy. */
        })());
    };
})();
