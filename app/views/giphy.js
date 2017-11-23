// vim: ts=4:sw=4:expandtab

// css overlay once giphy is selected (initial part done)
// css improvements
// actually send giphy ---> the big one
// css to make giphy flow exit actually be good

(function () {
    'use strict';

    self.F = self.F || {};

    F.GiphyThumbnailView = F.View.extend({
        template: 'views/giphy-thumbnail.html',
        className: 'f-giphy-thumbnail',

        events: {
            'click': 'onClick',
            'dblclick': 'onDoubleClick'
        },

        initialize: function(options) {
            this.composeView = options.composeView;
            this.render_attributes = options.giphy;
            this.term = options.term;
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.video = this.$('video')[0];
            this.$el.hover(async () => {
                try {
                    await this.video.play();
                } catch(e) {}
            }, () => {
                try {
                    this.video.pause();
                } catch(e) {}
            });
            return this;
        },

        onClick: function(e) {
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
            this.video.play();
            $dimmer.addClass('active');
            e.preventDefault();  // disable any built-in play/pause actions.
        },

        onDoubleClick: function(e) {
            e.preventDefault();  // disable fullscreen;
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
                `<video class="giphy" autoplay="true" loop="true" disableRemotePlayback="true">` +
                    `<source src="${this.render_attributes.images.original.mp4}"/>` +
                `</video>`);
        }
    });
})();
