// vim: ts=4:sw=4:expandtab
/* global Quill */

(function () {
    'use strict';

    self.F = self.F || {};

    F.AnnouncementView = F.ThreadView.extend({
        template: 'views/announcement.html',

        render: async function() {
            await F.ThreadView.prototype.render.call(this);
            if (!this.model.get('sent')) {
                this.editor = new Quill(this.$('.f-editor')[0], {
                    placeholder: 'Compose announcement...',
                    theme: 'snow'
                });
                this.$('button.f-send').on('click', this.onSend.bind(this));
            } else {
                /* view only model */
                console.warn("IMPLEMENT VIEW ONLY MODE");
            }
            return this;
        },

        onSend: async function() {
            const content = this.$('.f-editor .ql-editor')[0].innerHTML;
            await this.model.sendMessage(this.editor.getText(), content);
            this.editor.disable();
        }
    });
})();
