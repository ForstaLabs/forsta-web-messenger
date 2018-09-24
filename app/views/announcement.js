// vim: ts=4:sw=4:expandtab
/* global Quill, QuillDeltaToHtmlConverter */

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
            const quillConverter = new QuillDeltaToHtmlConverter(this.editor.getContents().ops);
            const $html = $(`<div style="white-space: pre-wrap; word-wrap: break-word;">${quillConverter.convert()}</div>`);
            // Convert all uses of class to style for portability.
            for (const el of $html.find('.ql-align-justify')) {
                el.classList.remove('ql-align-justify');
                el.style.setProperty('text-align', 'justify');
            }
            for (const el of $html.find('.ql-align-center')) {
                el.classList.remove('ql-align-center');
                el.style.setProperty('text-align', 'center');
            }
            for (const el of $html.find('.ql-align-right')) {
                el.classList.remove('ql-align-right');
                el.style.setProperty('text-align', 'right');
            }
            for (const el of $html.find('.ql-size-huge')) {
                el.classList.remove('ql-size-huge');
                el.style.setProperty('font-size', '2em');
            }
            for (const el of $html.find('.ql-size-large')) {
                el.classList.remove('ql-size-large');
                el.style.setProperty('font-size', '1.5em');
            }
            for (const el of $html.find('.ql-size-small')) {
                el.classList.remove('ql-size-small');
                el.style.setProperty('font-size', '0.75em');
            }
            for (let i = 1; i < 10; i++) {
                for (const el of $html.find(`.ql-indent-${i}`)) {
                    el.classList.remove(`ql-indent-${i}`);
                    el.style.setProperty('padding-left', `${3 * i}em`);
                }
            }
            for (const el of $html.find('.ql-font-monospace')) {
                el.classList.remove('ql-font-monospace');
                el.style.setProperty('font-family', 'monospace');
            }
            for (const el of $html.find('.ql-font-serif')) {
                el.classList.remove('ql-font-serif');
                el.style.setProperty('font-family', 'serif');
            }
            for (const el of $html.find('[class]')) {
                if (el.classList.length) {
                    F.util.reportWarning("Unconverted announcement class:", el.outerHTML);
                } else {
                    el.removeAttribute('class');
                }
            }
            await this.model.sendMessage(this.editor.getText(), $html[0].outerHTML);
            await this.model.save({sent: true});
            this.editor.disable();
            this.editor = null;
            this.$('.f-editor-mode').hide();
            await this.renderViewMode();
        }
    });
})();
