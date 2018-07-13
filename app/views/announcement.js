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
                await this.renderComposeMode();
            } else {
                await this.renderViewMode();
            }
            return this;
        },

        renderComposeMode: async function() {
            this.$('.f-editor-mode').show();
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
        },

        renderViewMode: async function() {
            this.$('.f-viewer-mode').show();
            await this.model.fetchMessages();
            this.model.clearUnread();  // bg okay
            const announcement = this.model.messages.models[0];
            this.$('.f-viewer-from').html('From: ' + (await announcement.getSender()).getName());
            this.$('.f-viewer-to').html('To: ' + this.model.get('distributionPretty'));
            this.$('.f-viewer-content').html(announcement.get('safe_html'));
        },

        onInputSubject: async function() {
            const subject = this.$('input[name="subject"]').val();
            const $sendBtn = this.$('.f-send');
            $sendBtn.toggleClass('disabled', !subject);
            await this.model.save({title: subject});
        },

        onClickSend: async function() {
            const html = this.$('.f-editor .ql-editor').html();
            await this.model.sendMessage(this.editor.getText(), html);
            await this.model.save({sent: true});
            this.editor.disable();
            this.editor = null;
            this.$('.f-editor-mode').hide();
            await this.renderViewMode();
        }
    });
})();
