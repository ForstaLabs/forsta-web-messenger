/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';
    window.Whisper = window.Whisper || {};

    Whisper.FileSizeToast = Whisper.ToastView.extend({
        templateName: 'file-size-modal',
        render_attributes: function() {
            return {
                name: this.model.name,
                'file-size-warning': 'File exceeds maximum upload size.',
                limit: this.model.limit,
                units: this.model.units
            };
        }
    });
    Whisper.UnsupportedFileTypeToast = Whisper.ToastView.extend({
        template: i18n('unsupportedFileType')
    });

    Whisper.FileInputView = Backbone.View.extend({
        tagName: 'span',
        className: 'file-input',
        initialize: function(options) {
            this.$input = this.$('input[type=file]');
            this.files = [];
            this.$el.addClass('file-input');
        },

        events: {
            'change .choose-file': 'onChooseFiles',
            'click .close': 'onThumbClose',
            'click .choose-file button': 'open'
        },

        open: function(e) {
            this.$input.click();
        },

        addThumb: function(src, file) {
            //this.$('.avatar').hide();
            const thumb = new Whisper.AttachmentPreviewView(src, file, this);
            this.$('.attachment-previews').append(thumb.render().el);
            thumb.$('img')[0].onload = function() {
                this.$el.trigger('force-resize');
            }.bind(this);
            return thumb;
        },

        autoScale: async function(file) {
            if (file.type.split('/')[0] !== 'image' || file.type === 'image/gif') {
                return file;
            }
            const image = await new Promise(function(resolve, reject) {
                const url = URL.createObjectURL(file);
                const img = document.createElement('img');
                img.onerror = reject;
                img.onload = function() {
                    URL.revokeObjectURL(url);
                    resolve(img);
                };
                img.src = url; // Trigger the load;
            });
            const maxSize = 10 * 1024 * 1024;
            const maxHeight = 4000;
            const maxWidth = 6000;
            if (image.width <= maxWidth &&
                image.height <= maxHeight &&
                file.size <= maxSize) {
                return file;
            }
            console.info("Scaling oversized image:", file);
            const canvas = loadImage.scale(image, {
                canvas: true,
                maxWidth: maxWidth,
                maxHeight: maxHeight
            });
            const min_quality = 0.10;
            let quality = 0.95;
            let blob;
            do {
                console.info("Scale attempt at quality:", quality);
                blob = dataURLtoBlob(canvas.toDataURL('image/jpeg', quality));
                quality *= .66;
            } while (blob.size > maxSize && quality > min_quality);
            return blob;
        },

        onChooseFiles: function(e) {
            const files = [];
            for (const f of this.$input.prop('files')) {
                files.push(f);
            }
            console.info("Processing file chooser attachments:", files);
            this.$input.wrap('<form>').parent('form').trigger('reset');
            this.$input.unwrap();
            this.addFiles(files);
        },

        addFiles: function(files) {
            for (const x of files) {
                this.addFile(x);
            }
        },

        addFile: async function(file) {
            file = await this.autoScale(file);
            const limit = 100 * 1024 * 1024;
            if (file.size > limit) {
                console.warn("File too big", file);
                var toast = new Whisper.FileSizeToast({
                    model: {
                        name: file.name,
                        limit: limit / 1024 / 1024,
                        units: 'MB'
                    }
                });
                toast.$el.insertAfter(this.$el);
                toast.render();
                return;
            }
            let thumb;
            const type = file.type.split('/')[0];
            switch (type) {
                case 'audio':
                    thumb = this.addThumb('images/audio.svg', file);
                    break;
                case 'video':
                    thumb = this.addThumb('images/video.svg', file);
                    break;
                case 'image':
                    thumb = this.addThumb(URL.createObjectURL(file), file);
                    break;
                default:
                    console.warn("Unhandled file type:", type, file);
                    thumb = this.addThumb('images/paperclip.svg', file);
                    break;
            }
            file.thumb = thumb;
            this.files.push(file);
        },

        removeFile: function(file) {
            file.thumb.remove();
            const idx = this.files.indexOf(file);
            if (idx === -1) {
                throw new Error(`File not found: ${file}`);
            }
            this.files.splice(idx, 1);
            this.$el.trigger('force-resize');
        },

        hasFiles: function() {
            return !!this.files.length;
        },

        getFiles: async function() {
            var pending = [];
            for (const x of this.files) {
                pending.push(this.getFile(x));
            }
            return await Promise.all(pending);
        },

        getFile: async function(file) {
            return await this.readFile(await this.autoScale(file));
        },

        getThumbnail: function() {
            // Scale and crop an image to 256px square
            var size = 256;
            var file = this.file || this.$input.prop('files')[0];
            if (file === undefined || file.type.split('/')[0] !== 'image' || file.type === 'image/gif') {
                // nothing to do
                return Promise.resolve();
            }

            return new Promise(function(resolve, reject) {
                var url = URL.createObjectURL(file);
                var img = document.createElement('img');
                img.onerror = reject;
                img.onload = function () {
                    URL.revokeObjectURL(url);
                    // loadImage.scale -> components/blueimp-load-image
                    // scale, then crop.
                    var canvas = loadImage.scale(img, {
                        canvas: true, maxWidth: size, maxHeight: size,
                        cover: true, minWidth: size, minHeight: size
                    });
                    canvas = loadImage.scale(canvas, {
                        canvas: true, maxWidth: size, maxHeight: size,
                        crop: true, minWidth: size, minHeight: size
                    });

                    // dataURLtoBlob -> components/blueimp-canvas-to-blob
                    var blob = dataURLtoBlob(canvas.toDataURL('image/png'));

                    resolve(blob);
                };
                img.src = url;
            }).then(this.readFile);
        },

        readFile: function(file) {
            return new Promise(function(resolve, reject) {
                var FR = new FileReader();
                FR.onload = function(e) {
                    resolve({data: e.target.result, contentType: file.type});
                };
                FR.readAsArrayBuffer(file);
            });
        },

        removeFiles: function() {
            while (this.files.length) {
                this.removeFile(this.files[0]);
            }
        }
    });
})();
