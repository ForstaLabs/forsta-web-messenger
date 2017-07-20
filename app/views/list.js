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
            this.listenTo(this.collection, 'add', this.onAdd);
            this.listenTo(this.collection, 'remove', this.onRemove);
            this.listenTo(this.collection, 'sort', this.onSort);
            this.listenTo(this.collection, 'reset', this.reset);
        },

        render: async function() {
            await F.View.prototype.render.apply(this, arguments);
            if (!this.holder) {
                this.$holder = this.$el;
            } else {
                const $holder = this.$(this.holder);
                this.$holder = $holder.length ? $holder : this.$el;
            }
            this._holder = this.$holder[0];
            await this.reset();
            return this;
        },

        onAdd: function(model) {
            /* Because our Views are async we have to queue adding models
             * to avoid races. */
            return F.queueAsync(this, this.addItem.bind(this, model));
        },

        onRemove: function(model) {
            this.removeItem(model);
        },

        onSort: function(model, options) {
            console.log("XXX list view onSort not implemented", model, options);
        },

        reset: async function() {
            this.$holder.html('');
            for (const model of this.collection.models) {
                await this.addItem(model);
            }
        },

        addItem: async function(model) {
            const item = new this.ItemView({model: model});
            await item.render();
            if (item.$el.length !== 1) {
                throw TypeError("ItemView MUST have exactly one root element");
            }
            const index = this.collection.indexOf(model);
            let referenceNode = this._holder.childNodes[this._holder.childNodes.length - index];
            if (!referenceNode) {
                this._holder.appendChild(item.el);
            } else {
                this._holder.insertBefore(item.el, referenceNode);
            }
            this.$holder.trigger('add');
        },

        removeItem: async function(model) {
            console.warn("remove item does nothing in list view", model);
        }
    });
})();
