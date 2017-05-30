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
    F.TableView = F.View.extend({
        itemView: F.View,

        initialize: function(options) {
            this.listenTo(this.collection, 'add', this.addOne);
            this.listenTo(this.collection, 'reset', this.addAll);
        },

        addOne: function(model) {
            if (this.itemView) {
                const view = new this.itemView({model: model});
                this.tbody.append(view.render().el);
                this.tbody.trigger('add');
            }
        },

        addAll: function() {
            this.tbody.html('');
            this.collection.each(this.addOne, this);
        },

        render: function() {
            F.View.prototype.render.apply(this, arguments);
            this.tbody = this.$el.find('tbody');
            if (!this.tbody.length) {
                throw new Error("Table body not found"); 
            }
            this.addAll();
            return this;
        }
    });
})();
