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
        template: 'Unsupported file type'
    });

    F.FileInputView = Backbone.View.extend({

        initialize: function(options) {
            this.files = [];
            this.$previews = this.$el.find('.previews');
            this.$input = this.$el.find('input[type=file]');
            this.$input.on('change', this.onChooseFiles.bind(this));
        },

        openFileChooser: function() {
            this.$input.click();
        },

        addThumb: async function(file) {
            const thumb = new F.AttachmentThumbnailView(file, this);
            await thumb.render();
            this.$previews.append(thumb.$el);
            if (!this.$el.hasClass('visible')) {
                this.$el.addClass('visible');
            }
            return thumb;
        },

        onChooseFiles: async function(e) {
            await this.addFiles(this.$input.prop('files'));
            this.$input.wrap('<form>').parent('form').trigger('reset');
            this.$input.unwrap();
        },

        addFiles: function(files) {
            return Promise.all(Array.from(files).map(this.addFile.bind(this)));
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
            file.thumb = await this.addThumb(file);
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

        getFiles: function() {
            return Promise.all(this.files.map(this.readFile));
        },

        getThumbnail: function() {
            // Scale and crop an image to 256px square
            var size = 256; // XXX make bigger
            var file = this.$input.prop('files')[0];
            if (file === undefined ||
                file.type.split('/')[0] !== 'image' ||
                file.type === 'image/gif') {
                return Promise.resolve();
            }

            return new Promise(function(resolve, reject) {
                var url = URL.createObjectURL(file);
                var img = document.createElement('img');
                img.onerror = reject;
                img.onload = function () {
                    URL.revokeObjectURL(url);
                    var canvas = loadImage.scale(img, {
                        canvas: true, maxWidth: size, maxHeight: size,
                        cover: true, minWidth: size, minHeight: size
                    });
                    canvas = loadImage.scale(canvas, {
                        canvas: true, maxWidth: size, maxHeight: size,
                        crop: true, minWidth: size, minHeight: size
                    });
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
                    resolve({
                        data: e.target.result,
                        contentType: file.type,
                        fileSize: file.size,
                        fileName: file.name,
                        fileLastModified: file.lastModifiedDate
                    });
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
