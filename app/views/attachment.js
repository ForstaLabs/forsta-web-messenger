/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    var AttachmentItemView = F.View.extend({
      template: 'views/attachment-item.html',
      initialize: function(dataUrl, type, meta, name) {
        this.dataUrl = dataUrl;
        this.type = type;
        this.contentType = this.type.split('/')[0];
        this.meta = meta;
        this.name = name;
      },
      render: async function() {
        await F.View.prototype.render.call(this);
      }
    });

    var FileView = AttachmentItemView.extend({
      getThumbnail: function(name) {
          const codeTypes = ["c", "h", "java", "py", "cpp", "pl", "asm", "bin", "rb", "sh", "go", "html", "css", "scss", "js", "swft"];
          let fileType = name.split(".")[1];
          if (codeTypes.indexOf(fileType) > -1) {
            fileType = "code";
          }
          switch (fileType) {
              case "code":
                  return "file code outline icon";
              case 'pdf':
                  return "file pdf outline icon";
              case 'ppt': case 'pptx':
                  return "file powerpoint outline icon";
              case 'doc': case 'docx':
                  return "file word outline icon";
              case 'xls': case 'xlsx':
                  return "file excel outline icon";
              case 'txt': case 'rtf':
                  return "file text outline icon";
              default:
                  return "file outline icon";
          }
      },
      render_attributes: function() {
          return {
              meta: this.meta,
              name: this.name,
              isPreviewable: false,
              thumbnail: this.getThumbnail(this.name),
              dataUrl: this.dataUrl
          };
      }
    });

    var ImageView = AttachmentItemView.extend({
        events: {
            'load': 'update',
        },
        update: function() {
            this.trigger('update');
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

    var MediaView = AttachmentItemView.extend({
        events: {
            'canplay': 'canplay'
        },
        canplay: function() {
            this.trigger('update');
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
            this.meta = this.getMeta(this.model, this.contentType);
        },

        events: {
            'click': 'onclick'
        },

        getMeta: function(a, contentType) {
            const fields = [];
            let flag = false;
            if (contentType === "image" || contentType === "video" || contentType === "audio") {
              flag = true;
            }
            if (a.name && a.name.length && flag) {
                fields.push(a.name);
            }
            if (a.type && a.type.length) {
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
                    this.handleImageModal();
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

        handleImageModal: async function() {
            await F.util.confirmModal({
                header: this.model.name,
                icon: 'image',
                content: `<img class="attachment-view" src="${this.objectUrl}"/>`,
                confirmLabel: 'Download',
                cancelLabel: 'Close'
            }) && this.saveFile();
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
