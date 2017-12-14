// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.PhoneSuggestionView = F.View.extend({
        template: 'util/phone_suggestion.html',

        initialize: function(user) {
            this.user = user;
        },

        events: {
            'click .f-sender': 'onClick',
        },

        onClick: async function() {
            const threads = F.foundation.allThreads;
            const sl = await this.user.getSlug();
            await F.mainView.openThread(await threads.ensure('@' + sl, {type: 'conversation'}));
            $('.modal').modal('hide');
        },

        render_attributes: async function() {
            const name = this.user.getName();
            const avatar = await this.user.getAvatar();
            const slug = await this.user.getFQSlug();
            const id = this.user.id;
            return {
                name,
                avatar,
                slug,
                id
            };
        }
    });
})();
