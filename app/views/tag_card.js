// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};


    // XXX move to it's own file.
    F.PopupView = F.View.extend({

        initialize: function(options) {
            this.tag = options.tag;
            this.anchorEl = options.anchorEl;
        },

        show: async function() {
            await this.render();
            this.$el.addClass('f-popup-view');
            $('body').append(this.$el);
        },
    });


    F.TagCardView = F.PopupView.extend({
        template: 'views/tag-card.html',

        render_attributes: async function() {
            const members = await F.atlas.getContacts(this.tag.userids);
            return {
                tag: this.tag,
                members: await Promise.all(members.map(async x => Object.assign({
                    name: x.getName(),
                    avatar: await x.getAvatar(),
                    tagSlug: x.getTagSlug(),
                }, x.attributes))),
                memberCount: this.tag.userids.length
            };
        }
    });
})();
