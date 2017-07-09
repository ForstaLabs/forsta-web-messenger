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
            this.listenTo(this.collection, 'add', this.onAddModel.bind(this));
            this.listenTo(this.collection, 'remove', this.onRemoveModel.bind(this));
            this.$('.ui.search').search();
            this.$dropdown.dropdown({
                preserveHTML: false,
                onAdd: this.onSelectionChange.bind(this, 'add'),
                onChange: this.onSelectionChange.bind(this, 'change'),
                onRemove: this.onSelectionChange.bind(this, 'remove')
            });
            if (this.collection.length) {
                this.collection.each(this.onAddModel.bind(this));
                this.maybeActivate();
            }
            return this;
        },

        maybeActivate: function() {
            if (this._active) {
                return;
            }
            this.$dropdown.removeClass('disabled');
            this.$dropdown.find('> .icon.loading').attr('class', 'icon plus');
            this._active = true;
        },

        onAddModel: function(tag) {
            const slug = tag.get('slug');
            this.$tagsMenu.append(`<div class="item" data-value="@${slug}"><i class="icon user"></i>@${slug}</div>`);
            this.maybeActivate();
        },

        onRemoveModel: function(tag) {
            debugger;
        },

        onSelectionChange: function(op, values) {
            // XXX so much
            console.log('new convo sel changes', op, values);
            this.$startButton.removeClass('disabled');
        },

        onStartClick: async function() {
            const expr = this.$dropdown.dropdown('get value');
            const tags = await this.collection.query(expr);
            debugger;
            console.log('value', tags);
        }
    });
})();
