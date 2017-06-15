/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';
    window.Whisper = window.Whisper || {};
    window.F = window.F || {};

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

    F.FileInputView = Backbone.View.extend({

        preview_image_types: [
            'image/gif',
            'image/jpeg',
            'image/png',
            'image/webp'
        ],

        initialize: function(options) {
            this.files = [];
            this.$previews = this.$el.find('.previews');
            this.$input = this.$el.find('input[type=file]');
            this.$input.on('change', this.onChooseFiles.bind(this));
        },

        openFileChooser: function() {
            this.$input.click();
        },

        addThumb: function(src, file) {
            const thumb = new Whisper.AttachmentPreviewView(src, file, this);
            this.$previews.append(thumb.render().el);
            if (!this.$el.hasClass('visible')) {
                this.$el.addClass('visible');
            }
            return thumb;
        },

        onChooseFiles: function(e) {
            const files = Array.from(this.$input.prop('files'));
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
                toast.$el.insertAfter(this.$previews);
                toast.render();
                return;
            }
            let thumbnail;
            const type = file.type.split('/')[0];
            if (file.type.startsWith('audio/')) {
                thumbnail = 'static/images/audio.svg';
            } else if (file.type.startsWith('video/')) {
                thumbnail = 'static/images/video.svg';
            } else if (this.preview_image_types.indexOf(file.type) !== -1) {
                thumbnail = URL.createObjectURL(file);
            } else {
                thumbnail = 'static/images/paperclip.svg';
            }
            file.thumb = this.addThumb(thumbnail, file);
            this.files.push(file);
        },

        removeFile: function(file) {
            const idx = this.files.indexOf(file);
            if (idx === -1) {
                throw new Error(`File not found: ${file}`);
            }
            this.files.splice(idx, 1);
            if (!this.files.length) {
                this.$el.removeClass('visible');
            }
            file.thumb.remove();
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
            if (file === undefined ||
                file.type.split('/')[0] !== 'image' ||
                file.type === 'image/gif') {
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
