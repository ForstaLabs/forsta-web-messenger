// vim: ts=4:sw=4:expandtab

// css overlay once giphy is selected (initial part done)
// css improvements
// actually send giphy

(function () {
    'use strict';

    self.F = self.F || {};

    F.GiphyThumbnailView = F.View.extend({
        template: 'views/giphy-thumbnail.html',
        className: 'f-giphy-thumbnail ui message',

        initialize: function(url, giph) {
            this.content = url;
            this.giph = giph;
            this.id = giph.id;
        },

        events: {
            'click button': 'prepSend',
        },

        prepSend: function() {
            console.info("Send giphy on this event");
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$(".thumbnail").hover((e) => {this.$('video')[0].play();}, (e) => {this.$('video')[0].pause();});
            return this;
        },

        render_attributes: function() {
            return {
                content: this.content,
                id: this.id
            };
        }
    });
})();
