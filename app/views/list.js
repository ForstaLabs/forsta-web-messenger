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
        itemView: F.View,
        holder: undefined, // default to self

        initialize: function(options) {
            this.listenTo(this.collection, 'add', this.addOne);
            this.listenTo(this.collection, 'reset', this.addAll);
        },

        addOne: function(model) {
            if (this.itemView) {
                const view = new this.itemView({model: model});
                this.$holder.append(view.render().el);
                this.$holder.trigger('add');
            }
        },

        addAll: function() {
            this.$holder.html('');
            this.collection.each(this.addOne, this);
        },

        render: function() {
            F.View.prototype.render.apply(this, arguments);
            this.$holder = this.$el.find(this.holder);
            if (!this.$holder.length) {
                this.$holder = this.$el;
            }
            this.addAll();
            return this;
        }
    });
})();
