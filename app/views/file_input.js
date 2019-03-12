// vim: ts=4:sw=4:expandtab
/* global loadImage dataURLtoBlob Backbone */

(function () {
    'use strict';
    self.F = self.F || {};

    F.FileInputView = Backbone.View.extend({

        events: {
            'change input[type=file]': 'onChooseFiles'
        },

        initialize: function(options) {
            this.files = [];
        },

        setElement: function() {
            const ret = Backbone.View.prototype.setElement.apply(this, arguments);
            this.$previews = this.$('.previews');
            this.$input = this.$('input[type=file]');
            return ret;
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
                await F.util.promptModal({
                    size: 'tiny',
                    icon: 'red warning sign',
                    header: 'Attachment too big',
                    content: `Max attachment size is ${F.tpl.help.humanbytes(limit)}`
                });
            } else {
                file.thumb = await this.addThumb(file);
                this.files.push(file);
            }
            this.trigger('add', file);
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
            this.trigger('remove', file);
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
                        type: file.type,
                        size: file.size,
                        name: file.name,
                        mtime: file.lastModified
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
