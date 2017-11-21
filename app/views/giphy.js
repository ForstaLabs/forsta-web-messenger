// vim: ts=4:sw=4:expandtab

// checklist:
// move functional giphy view to this file
// dont send message until gif is selected
// change margin from bottom for clarity
// css overlay once gif is selected (initial part done)
// css improvements

(function () {
    'use strict';

    self.F = self.F || {};

    F.GiphyThumbnailView = F.View.extend({
        template: 'views/giphy-thumbnail.html',
        className: 'f-giphy-thumbnail ui message',

        initialize: function(url, giph) {
            this.content = url;
            this.giph = giph;
        },

        events: {
            'click .thumbnail': 'prepSend',
        },

        prepSend: function() {
            console.info("Wire visual indicator of preparing to send");
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$(".thumbnail").hover((e) => {this.$('video')[0].play();}, (e) => {this.$('video')[0].pause();});
            return this;
        },

        render_attributes: function() {
            return {
                content: this.content
            };
        }
    });
})();
