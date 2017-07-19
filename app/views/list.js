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
            console.log("list view add", model);
            return F.queueAsync(this, this.addItem.bind(this, model));
        },

        onRemove: function(model) {
            this.removeItem(model);
        },

        onSort: function(model, options) {
            console.log("list view sort", model, options);
        },

        reset: async function() {
            this.$holder.html('');
            const ts = Date.now();
            for (const model of this.collection.models) {
                if (this._active) {
                    debugger;
                }
                await this.addItem(model);
            }
            console.warn("reset list view render:", Date.now() - ts, this.collection.models.length);
        },

        OLDaddItem: async function(model) {
            debugger;
            const item = new this.ItemView({model: model});
            await item.render();
            const index = this.collection.indexOf(model);
            console.info("addItem index:", index);
            item.$el.attr('data-index', index);
            let added;
            for (const x of this.$holder.children()) {
                if (Number(x.dataset.index) > index) {
                    console.info("insert before", x);
                    item.$el.insertBefore(x);
                    added = true;
                    break;
                }
            }
            if (!added) {
                console.info("append item, (no items found after this one's index)", index);
                this.$holder.append(item.$el);
            }
            this.$holder.trigger('add');
        },

        
        addItem: async function(model) {
            const item = new this.ItemView({model: model});
            await item.render();
            if (item.$el.length !== 1) {
                throw TypeError("ItemView MUST have exactly one root element");
            }
            const index = this.collection.indexOf(model);
            let referenceNode = this._holder.childNodes[this._holder.childNodes.length - index];
            console.log("INDEX", model.get('plain'), index, referenceNode, this._holder.childNodes.length, this.collection.models.length);
            if (!referenceNode) {
                console.log("append");
                this._holder.appendChild(item.el);
            } else {
                console.log("insert", this._holder.childNodes.length - index);
                this._holder.insertBefore(item.el, referenceNode);
            }
            this.$holder.trigger('add');
        },

        removeItem: async function(model) {
            console.warn("remove item do nothing in list view", model);
        }
    });
})();
