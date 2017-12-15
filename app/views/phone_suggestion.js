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
            const tag = this.user.getTagSlug();
            await F.mainView.openThread(await threads.ensure(tag, {type: 'conversation'}));
            $('.modal').modal('hide');
        },

        render_attributes: async function() {
            return {
                id: this.user.id,
                name: this.user.getName(),
                avatar: await this.user.getAvatar(),
                tagSlug: this.user.getTagSlug()
            };
        }
    });
})();
