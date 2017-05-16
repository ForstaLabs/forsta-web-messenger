/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};

    Whisper.AttachmentPreviewView = Whisper.View.extend({
        className: 'attachment-preview',
        templateName: 'attachment-preview',

        initialize: function(src, file, fileInput) {
            this.src = src;
            this.file = file;
            this.fileInput = fileInput;
        },

        events: {
            'click .close': 'onClose',
        },

        onClose: function(event) {
            this.fileInput.removeFile(this.file);
        },

        render_attributes: function() {
            return {
                source: this.src
            };
        }
    });
})();
