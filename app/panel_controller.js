/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};

    const favicon = $('#favicon');
    const imagepath = F.urls.static + 'images/';

    F.setUnreadTitle = function(count) {
        let icon;
        let title;
        if (count > 0) {
            icon = 'favicon-pending.png';
            title = `Forsta (${count})`;
        } else {
            icon = 'favicon.png';
            title = "Forsta";
        }
        favicon.attr('href', `${imagepath}/${icon}`);
        document.title = title;
    };
})();
