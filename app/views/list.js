/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};

    /*
    * Generic list view that watches a given collection, wraps its members in
    * a given child view and adds the child view elements to its own element.
    */
    F.ListView = F.View.extend({
        ItemView: F.View,
        holder: undefined, // default to self

        initialize: function(options) {
            this.listenTo(this.collection, 'add', this.queueOne);
            this.listenTo(this.collection, 'reset', this.addAll);
        },

        queueOne: function(model) {
            /* Because our Views are async we have to queue adding models
             * to avoid races. */
            return F.queueAsync(this, this.addOne.bind(this, model));
        },

        addOne: async function(model) {
            if (this.ItemView) {
                const view = new this.ItemView({model: model});
                await view.render();
                this.$holder.append(view.$el);
                this.$holder.trigger('add');
                return view;
            }
        },

        addAll: async function() {
            this.$holder.html('');
            for (const model of this.collection.models) {
                await this.addOne(model);
            }
        },

        render: async function() {
            await F.View.prototype.render.apply(this, arguments);
            if (!this.holder) {
                this.$holder = this.$el;
            } else {
                const $holder = this.$(this.holder);
                this.$holder = $holder.length ? $holder : this.$el;
            }
            await this.addAll();
            return this;
        }
    });
})();
