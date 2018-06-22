// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.ArchivedThreadsView = F.ModalView.extend({

        template: 'views/archived-threads.html',
        className: 'ui modal small',

        events: {
            'click .f-restore': 'onRestoreClick',
            'click .f-expunge': 'onExpungeClick',
            'click .f-dismiss': 'onDismiss',
        },

        initialize: function() {
            F.ModalView.prototype.initialize.apply(this, arguments);
            this.threads = new F.ThreadCollection();
        },

        render_attributes: async function() {
            return await Promise.all(this.threads.map(async x => Object.assign({
                normTitle: x.getNormalizedTitle(),
                avatar: await x.getAvatar(),
                messageCount: await x.messages.totalCount()
            }, x.attributes)));
        },

        render: async function() {
            await this.threads.fetch({
                index: {
                    name: 'archived-timestamp',
                    lower: [1],
                    order: 'desc'
                }
            });
            return await F.ModalView.prototype.render.apply(this, arguments);
        },

        onRestoreClick: async function(ev) {
            const row = $(ev.currentTarget).closest('.row');
            const thread = this.threads.get(row.data('id'));
            await thread.restore();
            await this.render();
        },

        onExpungeClick: async function(ev) {
            const row = $(ev.currentTarget).closest('.row');
            const thread = this.threads.get(row.data('id'));
            if (await F.util.confirmModal({
                header: "Expunge Thread?",
                allowMultiple: true,
                icon: 'bomb',
                size: 'tiny',
                content: "Please confirm that you want to delete this thread and ALL of its messages.",
                confirmLabel: 'Expunge',
                confirmClass: 'red'
            })) {
                await thread.expunge();
                await this.render();
            }
        },

        onDismiss: function(ev) {
            this.hide();
        }
    });
})();
