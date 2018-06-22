// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.ArchivedThreadsView = F.View.extend({
        // XXX This should be a modal view.

        template: 'views/archived-threads.html',

        className: 'ui modal small',

        events: {
            'click .f-restore': 'onRestoreClick',
            'click .f-expunge': 'onExpungeClick',
            'click .f-dismiss': 'onDismiss',
        },

        initialize: function() {
            F.View.prototype.initialize.apply(this, arguments);
            this.threads = new F.ThreadCollection();
            return this;
        },

        render: async function() {
            await this.threads.fetch({
                index: {
                    name: 'archived-timestamp',
                    lower: [1],
                    order: 'desc'
                }
            });
            return await F.View.prototype.render.apply(this, arguments);
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
        },

        render_attributes: async function() {
            return await Promise.all(this.threads.map(async x => Object.assign({
                normTitle: x.getNormalizedTitle(),
                avatar: await x.getAvatar(),
                messageCount: await x.messages.totalCount()
            }, x.attributes)));
        },

        show: async function() {
            // XXX if this was a modal view this would be obsolete
            if (!this._rendered) {
                await this.render();
            }
            this.$el.modal('show');
            if (F.util.isSmallScreen()) {
                F.ModalView.prototype.addPushState.call(this);
            }
        },

        hide: function() {
            // XXX if this was a modal view this would be obsolete
            this.$el.modal('hide', () => this.remove());
        }
    });
})();
