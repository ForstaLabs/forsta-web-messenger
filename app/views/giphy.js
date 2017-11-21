F.GiphyThumbnailView = F.View.extend({
    template: 'views/giphy-thumbnail.html',
    className: 'f-attachment-thumbnail ui message',

    initialize: function(url) {
        this.content = url;
    },

    render: async function() {
        await F.View.prototype.render.call(this);
        this.$("video").hover((e) => {this.$('video').play();}, (e) => {this.$('video').pause();});
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
            content: this.content
        };
    }
});
