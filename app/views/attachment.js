/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    var FileView = F.View.extend({
      template: 'article/attachment-item.html',
      initialize: function(dataUrl, contentType, meta, name) {
          console.info(this);
          this.dataUrl = dataUrl;
          this.meta = meta;
          this.name = name;
          this.thumbnail = this.getThumbnail(this.contentType);
      },
      render: async function() {
        await F.View.prototype.render.call(this);
      },
      getThumbnail: function(contentType) {
        return F.urls.static + "images/paperclip.svg";
      },
      render_attributes: function() {
          return {
              meta: this.meta,
              name: this.name,
              isPreviewable: false,
              thumbnail: this.thumbnail,
              dataUrl: this.dataUrl
          };
      }
    });

    var ImageView = F.View.extend({
        template: 'article/attachment-item.html',
        initialize: function(dataUrl, type, meta, name) {
            this.dataUrl = dataUrl;
            this.type = type;
            this.contentType = this.type.split('/')[0];
            this.meta = meta;
            this.name = name;
        },
        events: {
            'load': 'update',
        },
        update: function() {
            this.trigger('update');
        },
        render: async function() {
            await F.View.prototype.render.call(this);
        },
        render_attributes: function() {
            return {
                meta: this.meta,
                name: this.name,
                contentType: this.contentType,
                isPreviewable: true,
                dataUrl: this.dataUrl,
                type: this.type
            };
        }
    });

    var MediaView = F.View.extend({
        template: 'article/attachment-item.html',
        initialize: function(dataUrl, type, meta, name) {
            this.dataUrl = dataUrl;
            this.type = type;
            this.contentType = this.type.split('/')[0];
            this.meta = meta;
            this.name = name;
        },
        events: {
            'canplay': 'canplay'
        },
        canplay: function() {
            this.trigger('update');
        },
        render: async function() {
            await F.View.prototype.render.call(this);
        },
        render_attributes: function() {
            return {
                meta: this.meta,
                name: this.name,
                contentType: this.contentType,
                isPreviewable: true,
                dataUrl: this.dataUrl,
                type: this.type
            };
        }
    });

    var AudioView = MediaView.extend();
    var VideoView = MediaView.extend();

    F.AttachmentView = Backbone.View.extend({
        tagName: 'a',
        className: 'attachment',

        initialize: function() {
            this.blob = new Blob([this.model.data], {type: this.model.type});
            const parts = this.model.type.split('/');
            this.contentType = parts[0];
            this.fileType = parts[1];
            this.meta = this.getMeta(this.model);
        },

        events: {
            'click': 'onclick'
        },

        getMeta: function(a) {
            const fields = [];
            if (a.name && a.name.length) {
                fields.push(a.name);
            } else if (a.type && a.type.length) {
                const parts = a.type.toLowerCase().split('/');
                const type =  (parts[0] === 'application') ? parts[1] : parts[0];
                fields.push(type[0].toUpperCase() + type.slice(1) + ' Attachment');
            }
            if (a.size) {
                fields.push(F.tpl.help.humanbytes(a.size));
            }
            return fields.join(' | ');
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
                        modalOptions: {
                            onApprove: this.saveFile.bind(this)
                        }
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

        render: async function() {
            const View = {
                image: ImageView,
                audio: AudioView,
                video: VideoView
            }[this.contentType] || FileView;
            if (!this.objectUrl) {
                this.objectUrl = URL.createObjectURL(this.blob);
            }
            var view = new View(this.objectUrl, this.model.type, this.meta, this.model.name);
            view.$el.appendTo(this.$el);
            view.on('update', this.trigger.bind(this, 'update'));
            await view.render();
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
