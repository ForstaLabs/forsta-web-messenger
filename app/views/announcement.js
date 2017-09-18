// vim: ts=4:sw=4:expandtab
/* global Quill */

(function () {
    'use strict';

    self.F = self.F || {};

    F.AnnouncementView = F.ThreadView.extend({
        template: 'views/announcement.html',

        events: {
            'input input[name="subject"]': 'onInputSubject',
            'click .f-send': 'onClickSend'
        },

        render: async function() {
            await F.ThreadView.prototype.render.call(this);
            if (!this.model.get('sent')) {
                this.editor = new Quill(this.$('.f-editor')[0], {
                    placeholder: 'Compose announcement...',
                    theme: 'snow',
                    modules: {
                        toolbar: [
                              ['bold', 'italic', 'underline', 'strike'],
                              [{color: []}, {background: []}, {size: ['small', false, 'large', 'huge']}],
                              [{font: []}],
                              [{list: 'bullet'}, {list: 'ordered'}],
                              [{align: []}],
                              [{indent: '-1'}, {indent: '+1'}],
                              ['clean']
                        ]
                    }
                });
            } else {
                // XXX Obviously this is horrible...
                await this.model.fetchMessages();
                this.markRead();
                const announcement = this.model.messages.models[0];
                this.$('.f-viewer-holder').html(announcement.get('safe_html'));
            }
            return this;
        },

        onInputSubject: async function() {
            const subject = this.$('input[name="subject"]').val();
            const $sendBtn = this.$('.f-send');
            $sendBtn.toggleClass('disabled', !subject);
            await this.model.save({title: subject});
        },

        onClickSend: async function() {
            const content = this.$('.f-editor .ql-editor')[0].innerHTML;
            await this.model.sendMessage(this.editor.getText(), content);
            await this.model.save({sent: true});
            this.editor.disable();
        }
    });
})();
