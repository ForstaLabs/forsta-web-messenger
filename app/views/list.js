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
            this._addq = [];
            this.listenTo(this.collection, 'add', this.queueOne);
            this.listenTo(this.collection, 'reset', this.addAll);
        },

        queueOne: async function(model) {
            /* Because our Views are async we have to queue adding models
             * to avoid races. */
            this._addq.push(model);
            if (this._addq.length === 1) {
                /* No other calls are active; Do the work ourselves. */
                while (this._addq.length) {
                    const m = this._addq[0];
                    await this.addOne(m);
                    this._addq.shift(); // Mutate queue after yielding!
                }
            }
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
