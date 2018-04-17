// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.DistEditorView = F.View.extend({
        template: 'views/dist-editor.html',
        className: 'f-dist-editor',

        events: {
            'click .f-reset.button': 'onResetClick',
            'click .f-save.button': 'onSaveClick',
            'click .ui.label .delete.icon': 'onDeleteLabelClick',
        },

        render_attributes: async function() {
            const dist = await F.util.parseDistribution(this.model.get('distributionPretty'));
            const cleanDist = dist.filter(x => x.value !== ' + '); // Scrub implicit union
            return {
                thread: this.model,
                dist: await Promise.all(cleanDist.map(async x => {
                    const user = x.type === 'tag' && x.value.get('user');
                    let userInfo;
                    if (user) {
                        const contact = await F.atlas.getContact(user.id);
                        userInfo = Object.assign({
                            avatar: await contact.getAvatar({nolink: true}),
                            name: contact.getName(),
                        }, contact.attributes);
                    }
                    return Object.assign({userInfo}, x);
                }))
            };
        },

        onResetClick: function() {
            this.render({forcePaint: true});
        },

        onSaveClick: async function() {
            const $dimmer = this.$('.ui.dimmer');
            $dimmer.dimmer('show');
            try {
                const $dist = this.$('.f-visual-dist').clone();
                for (const el of $dist.find('.ui.label')) {
                    $(el).replaceWith(` ${el.dataset.tag} `);
                }
                const dist = await F.foundation.allThreads.normalizeDistribution($dist.text());
                console.info('Updating thread distribution:', dist.pretty);
                await this.model.save('distribution', dist.universal);
                await this.model.sendUpdate({
                    distribution: {
                        expression: dist.universal
                    }
                });
                this.trigger('saved', dist);
            } catch(e) {
                F.util.reportError("Unhandled thread dist editor error", e);
                F.util.promptModal({
                    header: 'Distribution Save Error',
                    icon: 'red warning sign',
                    content: e.toString()
                });
            } finally {
                $dimmer.dimmer('hide');
            }
        },

        onDeleteLabelClick: function(ev) {
            const $label = $(ev.currentTarget).closest('.ui.label');
            $label.remove();
        }
    });
})();
