// vim: ts=4:sw=4:expandtab
/* global  */

(function () {
    'use strict';

    self.F = self.F || {};

    F.SurrogateView = F.View.extend({
        el: 'main',

        initialize: function(options) {
            this.thread = options.thread;
            const View = {
                conversation: F.ConversationView,
                announcement: F.AnnouncementView
            }[this.thread.get('type')];
            this.threadView = new View(Object.assign({model: this.thread}, options));
        },

        render: async function() {
            this.$el.append(this.threadView.$el);
            await this.threadView.render();
            return this;
        }
    });
})();
