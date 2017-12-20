// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.PhoneSuggestionView = F.View.extend({
        template: 'views/phone_suggestion.html',

        className: 'ui modal small',

        initialize: function(options) {
            this.members = options.members;
        },

        events: {
            'click .f-sender': 'onClick',
        },

        onClick: async function(ev) {
            const threads = F.foundation.allThreads;
            const row = $(ev.target).closest('.member-row');
            const id = row.data('id');
            let member;
            for (const x of this.members) {
                if (x.id === id) {
                    member = x;
                    break;
                }
            }
            const tag = member.getTagSlug();
            await F.mainView.openThread(await threads.ensure(tag, {type: 'conversation'}));
            this.hide();
        },

        render_attributes: async function() {
            return await Promise.all(this.members.map(async x => ({
                id: x.id,
                name: x.getName(),
                avatar: await x.getAvatar(),
                tagSlug: x.getTagSlug()
            })));
        },

        show: async function() {
            if (!this._rendered) {
                await this.render();
            }
            this.$el.modal('show');
        },

        hide: async function() {
            this.$el.modal('hide');
        }
    });
})();
