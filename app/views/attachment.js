// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function () {
    'use strict';

    const autoDownloadLimits = {
        cellular: 128 * 1024,
        normal: 1 * 1024 * 1024
    };

    const AttachmentItemView = F.View.extend({

        template: 'views/attachment-item.html',

        events: {
            'click .f-load.button': 'onLoadClick',
            'click .f-download': 'onDownloadClick',
        },

        initialize: function(options) {
            this.attachment = options.attachment;
            this.message = options.message;
            this.contentType = options.contentType;
            this.fileType = options.fileType;
        },

        render_attributes: async function() {
            await this.assignURL();
            return Object.assign({
                contentType: this.contentType,
                fileType: this.fileType,
                url: this.url,
                loadError: this.loadError
            }, this.attachment);
        },

        render: async function() {
            if (this.attachment && !this.attachment.data) {
                const connection = F.util.isCellular() ? 'cellular' : 'normal';
                const downloadLimit = autoDownloadLimits[connection];
                if (this.attachment.size < downloadLimit) {
                    await this.loadAttachment();
                }
            }
            return await F.View.prototype.render.call(this);
        },

        saveFile: async function() {
            if (await this.loadAttachment() === false) {
                await this.render();  // Errored out.
                return;
            }
            const link = document.createElement('a');
            link.download = this.attachment.name || ('Forsta_Attachment.' + this.fileType);
            link.href = URL.createObjectURL(new Blob([this.attachment.data],
                                                     {type: this.attachment.type}));
            link.style.display = 'none';
            document.body.appendChild(link);
            try {
                link.click();
            } finally {
                link.remove();
                URL.revokeObjectURL(link.href);
            }
        },

        assignURL: async function() {
            if (!this.attachment) {
                return;
            }
            if (this.url) {
                if (this._dataRef && Object.is(this._dataRef, this.attachment.data)) {
                    return;  // Same data, optimize out work.
                }
                URL.revokeObjectURL(this._url);
                this.url = null;
            }
            if (this.attachment.data) {
                this.url = await this.convertAttachmentToUrl(this.attachment);
                this._dataRef = this.attachment.data;
            }
        },

        convertAttachmentToUrl: function(attachment) {
            const blob = new Blob([attachment.data], {type: attachment.type});
            return URL.createObjectURL(blob);
        },

        loadAttachment: async function() {
            this.loadError = null;
            if (!this.attachment.data) {
                if (!this.attachment.id) {
                    // It's possible to render local attachments that aren't uploaded yet without
                    // and ID yet, but never a non-local attachment without an ID to fetch with.
                    throw new TypeError("Unexpected missing id from non-local attachment");
                }
                try {
                    await this.message.fetchAttachmentData(this.attachment.id);
                } catch(e) {
                    this.loadError = e.message;
                    return false;
                }
            }
            await this.assignURL();
        },

        onLoadClick: async function(ev) {
            const $button = $(ev.currentTarget);
            if ($button.hasClass('loading')) {
                return;
            }
            $button.addClass('loading');
            try {
                await this.loadAttachment();
                await this.render();
            } finally {
                $button.removeClass('loading');
            }
        },

        onDownloadClick: async function() {
            await this.saveFile();
        }
    });


    const FileView = AttachmentItemView.extend({

        getIcon: function() {
            const name = this.attachment.name;
            switch (name && name.split(".").pop()) {
                case "asm":
                case "c":
                case "c++":
                case "cc":
                case "cpp":
                case "cs":
                case "css":
                case "f":
                case "go":
                case "h":
                case "html":
                case "java":
                case "js":
                case "json":
                case "m":
                case "pl":
                case "py":
                case "rb":
                case "scss":
                case "sh":
                case "swift":
                case "vb":
                case "xml":
                case "yaml":
                case "yml":
                    return "file code outline";
                case 'pdf':
                    return "file pdf outline";
                case 'ppt':
                case 'pptx':
                    return "file powerpoint outline";
                case 'doc':
                case 'docx':
                    return "file word outline";
                case 'xls':
                case 'xlsx':
                    return "file excel outline";
                case 'txt':
                case 'rtf':
                    return "file text outline";
                default:
                    return "file outline";
            }
        },

        render_attributes: async function() {
            return Object.assign({
                isPreviewable: false,
                icon: this.getIcon(),
            }, await AttachmentItemView.prototype.render_attributes.call(this));
        }
    });


    const ImageView = AttachmentItemView.extend({

        events: {
            'click img.link': 'onImageClick',
        },

        render_attributes: async function() {
            return Object.assign({
                isPreviewable: true,
            }, await AttachmentItemView.prototype.render_attributes.call(this));
        },

        onImageClick: async function() {
            if (await F.util.confirmModal({
                header: this.attachment.name,
                size: 'fullscreen',
                icon: 'image',
                content: `<img class="attachment-view" src="${this.url}"/>`,
                confirmLabel: 'Download'
            })) {
                await this.saveFile();
            }
        },

        convertAttachmentToUrl: async function(attachment) {
            const blob = new Blob([attachment.data], {type: attachment.type});
            const [canvas] = await F.util.loadBlueImpImage(blob, {
                orientation: true,
                canvas: true
            });
            return canvas.toDataURL('image/png');
        }
    });


    const MediaView = AttachmentItemView.extend({
        render_attributes: async function() {
            return Object.assign({
                isPreviewable: true,
            }, await AttachmentItemView.prototype.render_attributes.call(this));
        }
    });


    F.AttachmentView = Backbone.View.extend({
        className: 'attachment',

        initialize: function(options) {
            const attachment = options.attachment;
            const parts = attachment.type.split('/');
            const contentType = parts[0];
            const fileType = parts[1];
            const View = {
                image: ImageView,
                audio: MediaView,
                video: MediaView
            }[contentType] || FileView;
            const message = options.message;
            this.itemView = new View({attachment, message, contentType, fileType});
        },

        render: async function() {
            try {
                await this.itemView.render();
            } catch(e) {
                // Possibly degrade to FileView if media isn't supported.
                if (this.itemView instanceof FileView) {
                    throw e;
                }
                console.warn('Failed to load media:', e);
                this.itemView = new FileView({
                    attachment: this.itemView.attachment,
                    message: this.itemView.message,
                    contentType: this.itemView.contentType,
                    fileType: this.itemView.contentType
                });
                await this.itemView.render();
            }
            this.$el.append(this.itemView.$el);
            return this;
        }
    });


    F.AttachmentThumbnailView = F.View.extend({
        template: 'views/attachment-thumbnail.html',
        className: 'f-attachment-thumbnail ui message',

        preview_image_types: [
            'image/gif',
            'image/jpeg',
            'image/png',
            'image/webp'
        ],

        initialize: function(file, fileInput) {
            this.file = file;
            this.fileInput = fileInput;
            this.type = null;
            this.content = URL.createObjectURL(file);
            if (file.type.startsWith('audio/')) {
                this.thumbnail = F.util.versionedURL(F.urls.static + 'images/audio.svg');
                this.type = 'audio';
            } else if (file.type.startsWith('video/')) {
                this.thumbnail = F.util.versionedURL(F.urls.static + 'images/video.svg');
                this.type = 'video';
            } else if (this.preview_image_types.indexOf(file.type) !== -1) {
                this.thumbnail = URL.createObjectURL(file);
                this.type = 'image';
            } else {
                this.thumbnail = F.util.versionedURL(F.urls.static + 'images/paperclip.svg');
            }
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$el.popup({
                variation: 'flowing',
                html: [
                    `<h5>${this.file.name}</h5>`,
                    'Size: ', F.tpl.help.humanbytes(this.file.size), '<br/>',
                    'Type: ', this.file.type, '<br/>',
                    'Date: ', F.tpl.help.calendar(this.file.lastModifiedDate)
                ].join('')
            });
            return this;
        },

        events: {
            'click .close': 'onClose',
        },

        onClose: function() {
            this.fileInput.removeFile(this.file);
        },

        render_attributes: function() {
            return {
                thumbnail: this.thumbnail,
                content: this.content,
                audio: this.type === 'audio',
                video: this.type === 'video',
                file: this.file
            };
        }
    });
})();
