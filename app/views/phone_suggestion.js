// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.PhoneSuggestionView = F.ModalView.extend({

        contentTemplate: 'views/phone-suggestion.html',
        size: 'small',
        icon: 'info circle',
        header: 'Existing Users Found',

        initialize: function(options) {
            this.members = options.members;
            F.ModalView.prototype.initialize.call(this);
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
            return Object.assign({
                members: await Promise.all(this.members.map(async x => ({
                    id: x.id,
                    name: x.getName(),
                    avatar: await x.getAvatar({allowMultiple: true}),
                    tagSlug: x.getTagSlug()
                }))),
            }, await F.ModalView.prototype.render_attributes.apply(this, arguments));
        }
    });
})();
