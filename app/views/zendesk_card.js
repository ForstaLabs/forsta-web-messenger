// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};

    F.ZendeskCardView = F.PopupView.extend({

        template: 'views/zendesk-card.html',

        initialize: function(options) {
            this.article = options.article;
            F.PopupView.prototype.initialize.apply(this, arguments);
        },

        render_attributes: async function() {
            return await F.util.fetchZendeskArticle(this.article);
        }
    });
})();
