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
            this.$el.hover(() => this.$('video')[0].play(), () => this.$('video')[0].pause());
            return this;
        },

        onClick: function(e) {
            if (this.confirming) {
                this.send();
                this.$('.ui.dimmer').removeClass('active');
                return;
            }
            this.confirming = true;
            this.$el.siblings().find('.ui.dimmer').removeClass('active');
            for (const video of this.$el.siblings().find('video')) {
                video.pause();
            }
            this.$('video')[0].play();
            this.$('.ui.dimmer').addClass('active');
        },

        onDoubleClick: function(e) {
            e.preventDefault();  // disable fullscreen;
            this.send();
        },

        send: function() {
            this.composeView.model.sendMessage(`/giphy ${this.term}`,
                `<video autoplay loop><source src="${this.render_attributes.images.original.mp4}"/></video>` +
                `<p class="giphy"><q>/giphy ${this.term}</q></p>`);
            this.$('video')[0].pause();
            this.confirming = undefined;
            this.composeView.$('.f-giphy').removeClass('visible');
        }
    });
})();
