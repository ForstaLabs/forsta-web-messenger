/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    var FileView = Backbone.View.extend({
      tagName: 'a',
      initialize: function(dataUrl) {
          this.dataUrl = dataUrl;
          this.$el.text('File Attachment');
      },
      render: function() {
        this.$el.attr('href', this.dataUrl);
        this.trigger('update');
        return this;
      }
    });

    var ImageView = Backbone.View.extend({
        tagName: 'img',

        initialize: function(dataUrl) {
            this.dataUrl = dataUrl;
        },

        events: {
            'load': 'update',
        },

        update: function() {
            this.trigger('update');
        },

        render: function() {
            this.$el.attr('src', this.dataUrl);
            return this;
        }
    });

    var MediaView = Backbone.View.extend({
        initialize: function(dataUrl, contentType) {
            this.dataUrl = dataUrl;
            this.contentType = contentType;
            this.$el.attr('controls', '');
        },

        events: {
            'canplay': 'canplay'
        },

        canplay: function() {
            this.trigger('update');
        },

        render: function() {
            var $el = $('<source>');
            $el.attr('src', this.dataUrl);
            $el.attr('type', this.contentType);
            this.$el.append($el);
            return this;
        }
    });

    var AudioView = MediaView.extend({tagName: 'audio'});
    var VideoView = MediaView.extend({tagName: 'video'});

    F.AttachmentView = Backbone.View.extend({
        tagName: 'a',
        className: 'attachment',

        initialize: function() {
            this.blob = new Blob([this.model.data], {type: this.model.type});
            const parts = this.model.type.split('/');
            this.contentType = parts[0];
            this.fileType = parts[1];
        },

        events: {
            'click': 'onclick'
        },

        onclick: function(e) {
            switch (this.contentType) {
                case 'audio':
                    break;
                case 'video':
                    var vid = e.target;
                    vid.paused ? vid.play() : vid.pause();
                    return;
                case 'image':
                    var view = new F.ModalView({
                        header: this.model.name,
                        content: `<img class="attachment-view" src="${this.objectUrl}"/>`,
                        actions: [{
                            class: 'approve',
                            label: 'Download'
                        }, {
                            class: 'cancel',
                            label: 'Close'
                        }],
                        onApprove: this.saveFile.bind(this)
                    });
                    view.show();
                    break;
                default:
                    this.saveFile();
            }
        },

        saveFile: function() {
            const link = document.createElement('a');
            link.download = this.model.name || ('Forsta_Attachment.' + this.fileType);
            link.href = this.objectUrl;
            link.click();
        },

        render: function() {
            const View = {
                image: ImageView,
                audio: AudioView,
                video: VideoView
            }[this.contentType] || FileView;
            if (!this.objectUrl) {
                this.objectUrl = URL.createObjectURL(this.blob);
            }
            var view = new View(this.objectUrl, this.model.type);
            view.$el.appendTo(this.$el);
            view.on('update', this.trigger.bind(this, 'update'));
            view.render();
            return this;
        }
    });

    F.AttachmentThumbnailView = F.View.extend({
        template: 'article/attachment-thumbnail.html',
        templateRootAttach: true,

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
                this.thumbnail = F.urls.static + 'images/audio.svg';
                this.type = 'audio';
            } else if (file.type.startsWith('video/')) {
                this.thumbnail = F.urls.static + 'images/video.svg';
                this.type = 'video';
            } else if (this.preview_image_types.indexOf(file.type) !== -1) {
                this.thumbnail = URL.createObjectURL(file);
                this.type = 'image';
            } else {
                this.thumbnail = F.urls.static + 'images/paperclip.svg';
            }
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$el.popup();
        },

        events: {
            'click .close': 'onClose',
        },

        onClose: function(event) {
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
