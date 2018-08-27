// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};

    F.TagCardView = F.PopupView.extend({

        template: 'views/tag-card.html',

        initialize: function(options) {
            this.tag = options.tag;
            F.PopupView.prototype.initialize.call(this, options);
        },

        render_attributes: async function() {
            const directMembers = new Set(await this.tag.getMembers(/*onlyDirect*/ true));
            const allMembers = await this.tag.getContacts();
            allMembers.sort((a, b) => b.getTagSlug() < a.getTagSlug() ? 1 : -1);
            return {
                tag: this.tag.attributes,
                slug: this.tag.getSlug(),
                children: await Promise.all((await this.tag.getChildren()).map(async x => ({
                    id: x.id,
                    tagSlug: x.getSlug(),
                    memberCount: (await x.getMembers()).length
                }))),
                totalMembers: (await this.tag.getMembers()).length,
                members: await Promise.all(allMembers.map(async x => Object.assign({
                    name: x.getName(),
                    avatar: await x.getAvatar(),
                    tagSlug: x.getTagSlug(),
                    direct: directMembers.has(x.id)
                }, x && x.attributes)))
            };
        }
    });
})();
