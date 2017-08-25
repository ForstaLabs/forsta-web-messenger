// vim: ts=4:sw=4:expandtab
/* global Quill */

(function () {
    'use strict';

    self.F = self.F || {};

    F.AnnouncementView = F.ThreadView.extend({
        template: 'views/announcement.html',

        render: async function() {
            await F.ThreadView.prototype.render.call(this);
            const editor = new Quill(this.el, {
                debug: 'info',
                modules: {
                    toolbar: '#toolbar'
                },
                placeholder: 'Compose an epic...',
                readOnly: true,
                theme: 'snow'
            });
            console.warn("now what XXX", editor);
        }
    });
})();
