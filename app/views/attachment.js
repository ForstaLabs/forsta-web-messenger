/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    var FileView = Backbone.View.extend({
      tagName: 'a',
      initialize: function(dataUrl) {
          this.dataUrl = dataUrl;
          this.$el.text(i18n('unsupportedAttachment'));
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
            this.blob = new Blob([this.model.data], {type: this.model.contentType});
            const parts = this.model.contentType.split('/');
            this.contentType = parts[0];
            this.fileType = parts[1];
        },

        events: {
            'click': 'onclick'
        },

        onclick: function(e) {
            switch (this.contentType) {
                case 'audio':
                case 'video':
                    return;
                case 'image':
                    var view = new Whisper.LightboxView({model: this});
                    view.render();
                    view.$el.appendTo(this.el);
                    view.$el.trigger('show');
                    break;

                default:
                    this.saveFile();
            }
        },

        saveFile: function() {
            const link = document.createElement('a');
            if (this.fileType) {
                link.download = 'Forsta_Attachment.' + this.fileType;
            }
            link.href = this.objectUrl;
            link.click();
        },

        render: function() {
            var View;
            switch(this.contentType) {
                case 'image': View = ImageView; break;
                case 'audio': View = AudioView; break;
                case 'video': View = VideoView; break;
                default     : View = FileView; break;
            }
            if (!this.objectUrl) {
                this.objectUrl = window.URL.createObjectURL(this.blob);
            }
            var view = new View(this.objectUrl, this.model.contentType);
            view.$el.appendTo(this.$el);
            view.on('update', this.trigger.bind(this, 'update'));
            view.render();
            return this;
        }
    });

  Whisper.LightboxView = Whisper.View.extend({
      templateName: 'lightbox',
      className: 'xmodal lightbox',

      initialize: function() {
          this.listener = this.onkeyup.bind(this);
          $(document).on('keyup', this.listener);
      },

      events: {
          'click .save': 'save',
          'click .close': 'remove',
          'click': 'onclick'
      },

      save: function(e) {
            this.model.saveFile();
      },

      onclick: function(e) {
          var $el = this.$(e.target);
          if (!$el.hasClass('image') && !$el.closest('.controls').length ) {
              e.preventDefault();
              this.remove();
              return false;
          }
      },

      onkeyup: function(e) {
          if (e.keyCode === 27) {
              this.remove();
              $(document).off('keyup', this.listener);
          }
      },

      render_attributes: function() {
          return { url: this.model.objectUrl };
      }
  });

    F.AttachmentThumbnailView = F.View.extend({
        templateUrl: 'templates/article/attachment-thumbnail.html',
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
                this.thumbnail = 'static/images/audio.svg';
                this.type = 'audio';
            } else if (file.type.startsWith('video/')) {
                this.thumbnail = 'static/images/video.svg';
                this.type = 'video';
            } else if (this.preview_image_types.indexOf(file.type) !== -1) {
                this.thumbnail = URL.createObjectURL(file);
                this.type = 'image';
            } else {
                this.thumbnail = 'static/images/paperclip.svg';
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
