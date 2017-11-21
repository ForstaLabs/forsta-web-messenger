// vim: ts=4:sw=4:expandtab

// checklist:
// move functional giphy view to this file
// dont send message until gif is selected
// sideways scroll to select gif
// css overlay once gif is selected
// add metadata and data to giphy class
// css improvements

(function () {
    'use strict';

    self.F = self.F || {};

    F.GiphyThumbnailView = F.View.extend({
        template: 'views/giphy-thumbnail.html',
        className: 'f-attachment-thumbnail ui message',

        initialize: function(url) {
            this.content = url;
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$(".thumbnail").hover((e) => {this.$('video').play();}, (e) => {this.$('video').pause();});
            return this;
        },

        render_attributes: function() {
            return {
                content: this.content
            };
        }
    });
})();
