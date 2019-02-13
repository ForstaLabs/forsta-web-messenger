// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.ArchivedThreadsView = F.ModalView.extend({

        contentTemplate: 'views/archived-threads.html',
        size: 'small',
        icon: 'archive',
        header: 'Archived Threads',
        actions: [{
            label: 'Expunge ALL',
            class: 'red f-expunge-all'
        }, {
            label: 'Dismiss',
            class: 'approve'
        }],

        events: {
            'click .f-restore': 'onRestoreClick',
            'click .f-expunge': 'onExpungeClick',
            'click .f-expunge-all': 'onExpungeAllClick',
        },

        initialize: function() {
            F.ModalView.prototype.initialize.apply(this, arguments);
            this.threads = new F.ThreadCollection();
        },

        render_attributes: async function() {
            return Object.assign({
                threads: await Promise.all(this.threads.map(async x => Object.assign({
                    normTitle: x.getNormalizedTitle(),
                    avatar: await x.getAvatar({allowMultiple: true}),
                    messageCount: await x.messages.totalCount()
                }, x.attributes))),
            }, await F.ModalView.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            if (!this._rendered) {
                // This is slow to load the first time, so work in the BG and update when done.
                await F.ModalView.prototype.render.apply(this, arguments);
                this.toggleLoading(true);
                F.util.animationFrame().then(() => this.render());
            } else {
                await this.threads.fetch({
                    index: {
                        name: 'archived-timestamp',
                        lower: [1],
                        order: 'desc'
                    }
                });
                await F.ModalView.prototype.render.apply(this, arguments);
                this.toggleLoading(false);
            }
            if (this.threads.length) {
                this.$('.f-expunge-all').show();
            } else {
                this.$('.f-expunge-all').hide();
            }
            return this;
        },

        onRestoreClick: async function(ev) {
            const row = $(ev.currentTarget).closest('.row');
            const thread = this.threads.get(row.data('id'));
            this.toggleLoading(true);
            try {
                await thread.restore();
                await this.render();
            } finally {
                this.toggleLoading(false);
            }
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
                this.toggleLoading(true);
                try {
                    await thread.expunge();
                    await this.render();
                } finally {
                    this.toggleLoading(false);
                }
            }
        },

        onExpungeAllClick: async function(ev) {
            if (await F.util.confirmModal({
                header: "Expunge ALL Threads?",
                allowMultiple: true,
                icon: 'bomb',
                size: 'tiny',
                content: "Please confirm that you want to delete <b>ALL</b> archived threads and their messages permanently.",
                confirmLabel: 'Expunge ALL Threads',
                confirmClass: 'red'
            })) {
                this.toggleLoading(true);
                try {
                    const total = this.threads.length;
                    let i = 1;
                    for (const thread of Array.from(this.threads.models)) {
                        console.warn("Expunging:", thread.getNormalizedTitle(/*text*/ true));
                        this.toggleLoading(true, `Expunging thread ${i++} of ${total}...<br/><br/>
                                                  <small>${thread.getNormalizedTitle()}</small>`);
                        await thread.expunge();
                    }
                    await this.render();
                } finally {
                    this.toggleLoading(false);
                }
            }
        }

    });
})();
