// vim: ts=4:sw=4:expandtab
/* global Quill */

(function () {
    'use strict';

    self.F = self.F || {};

    F.AnnouncementView = F.ThreadView.extend({
        template: 'views/announcement.html',

        render: async function() {
            await F.ThreadView.prototype.render.call(this);
            this.editor = new Quill(this.$('.f-editor')[0], {
                placeholder: 'Compose announcement...',
                theme: 'snow'
            });
            this.$('button.f-send').on('click', this.onSend.bind(this));
        },

        onSend: async function() {
            await this.model.sendMessage(this.editor.getText(), this.$('.f-editor .ql-editor')[0].innerHTML, []);
            this.editor.disable();
        }
    });
})();
