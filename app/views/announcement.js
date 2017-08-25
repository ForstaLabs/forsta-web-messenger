// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.AnnouncementView = F.ThreadView.extend({
        template: 'article/announcement.html',

        render: async function() {
            F.ThreadView.prototype.render.call(this);
            tinymce.init({selector: '.f-editor textarea'});
            return this;
        }
    });
})();
