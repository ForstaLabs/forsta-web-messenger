/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};

    const favicon = $('#favicon');
    const imagepath = 'static/images/';

    Whisper.setUnreadTitle = function(count) {
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

    // XXX for testing
    //setInterval(() => Whisper.setUnreadTitle(Math.random() - 0.5), 1000);
})();
