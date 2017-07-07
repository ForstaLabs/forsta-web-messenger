/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.NewConvoView = F.View.extend({

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$dropdown = this.$('.dropdown');
            this.$tagsMenu = this.$dropdown.find('.f-tags.menu');
            this.$startButton = this.$('.f-start.button');
            this.$startButton.on('click', this.onStartClick.bind(this));
            this.listenTo(this.collection, 'add', this.onAddTag.bind(this));
            this.listenTo(this.collection, 'remove', this.onRemoveTag.bind(this));
            this.$('.ui.search').search();
            this.$dropdown.dropdown({
                onAdd: this.onSelectionChange.bind(this),
                onRemove: this.onSelectionChange.bind(this)
            });
            return this;
        },

        onAddTag: function(tag) {
            const slug = tag.get('slug');
            this.$tagsMenu.append(`<div class="item" data-value="@${slug}"><i class="icon user"></i>@${slug}</div>`);
        },

        onSelectionChange: function(values) {
            // XXX so much
            console.log('new convo sel changes', values);
            this.$startbutton.removeClass('disabled');
        },

        onRemoveTag: function(tag) {
            debugger;
        },

        onStartClick: function() {
            console.log('start it');
        }
    });
})();
