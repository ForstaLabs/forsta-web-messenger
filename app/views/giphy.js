// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.GiphyThumbnailView = F.View.extend({
        template: 'views/giphy-thumbnail.html',
        className: 'f-giphy-thumbnail',

        initialize: function(options) {
            this.composeView = options.composeView;
            this.render_attributes = options.giphy;
            this.term = options.term;
        },

        play: async function() {
            try {
                await this.video.play();
            } catch(e) {
                console.debug("Ignoring mobile play restriction exception", e);
            }
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.video = this.$('video')[0];
            this.el.addEventListener('click', this.onClick.bind(this), {useCapture: true});
            this.el.addEventListener('dblclick', this.onDoubleClick.bind(this), {useCapture: true});
            this.$el.hover(this.play.bind(this), this.video.pause.bind(this.video));
            return this;
        },

        onClick: async function(e) {
            e.stopPropagation();  // disable any built-in play/pause actions.
            const $dimmer = this.$('.ui.dimmer');
            if ($dimmer.hasClass('active')) {
                this.send();
                $dimmer.removeClass('active');
                return;
            }
            const $siblings = this.$el.siblings();
            $siblings.find('.ui.dimmer').removeClass('active');
            for (const video of $siblings.find('video')) {
                video.pause();
            }
            $dimmer.addClass('active');
            await this.play();
        },

        onDoubleClick: function(e) {
            e.stopPropagation();  // disable fullscreen;
            this.send();
        },

        send: function() {
            if (this.sending) {
                return;
            }
            this.sending = true;
            this.video.pause();
            this.composeView.$('.f-giphy').removeClass('visible');
            this.composeView.model.sendMessage(`/giphy ${this.term}`,
                `<video title="${this.term}" f-type="giphy"
                        muted autoplay loop disableRemotePlayback playsinline>` +
                    `<source src="${this.render_attributes.images.original.mp4}"/>` +
                `</video>`);
            this.composeView.resetInputField();
        }
    });
})();
