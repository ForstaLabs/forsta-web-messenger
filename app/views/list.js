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
            this.reverse = options.reverse;
            this.listenTo(this.collection, 'add', this.addModel);
            this.listenTo(this.collection, 'reposition', this.repositionModel);
            this.listenTo(this.collection, 'reset', this.resetCollection);
            this.listenTo(this.collection, 'remove', this.removeModel);
            this._views = {};
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
            await this.resetCollection();
            return this;
        },

        remove: function() {
            F.View.prototype.remove.apply(this, arguments);
            for (const v of Object.values(this._views)) {
                v.remove();
            }
            this._views = {};
        },

        addModel: function(model) {
            /* Because our Views are async we have to queue adding views
             * to avoid races. */
            const item = new this.ItemView({model});
            this._views[model.id] = item;
            return F.queueAsync(this, this._addItem.bind(this, item));
        },

        removeModel: function(model) {
            const item = this._views[model.id];
            delete this._views[model.id];
            return F.queueAsync(this, this._removeItem.bind(this, item));
        },

        repositionModel: function(model, newIndex, oldIndex) {
            /* Must be manually triggered by the collection attached to this view. */
            /* Because our Views are async we have to queue sorting models
             * to avoid races. */
            return F.queueAsync(this, this._repositionModel.bind(this, model, newIndex, oldIndex));
        },

        resetCollection: function() {
            return F.queueAsync(this, this._resetCollection.bind(this));
        },

        _repositionModel: async function(model, newIndex, oldIndex) {
            const node = this._getNode(oldIndex);
            const adj = newIndex > oldIndex ? 1 : 0;
            this._insertNode(node, newIndex + adj);
        },

        _insertNode: function(node, index) {
            /* Note that these DOM methods will move the node if it's currently attached. */
            const offset = this.reverse ? -1 : 0;
            let afterNode = this._getNode(index + offset);
            if (!afterNode) {
                this._holder.appendChild(node);
            } else {
                this._holder.insertBefore(node, afterNode);
            }
        },

        _getNode: function(index) {
            if (this.reverse) {
                index = this._holder.childNodes.length - index - 1;
            }
            return this._holder.childNodes[index];
        },

        _resetCollection: async function() {
            Object.values(this._views).map(x => x.remove());
            this._views = {};
            const rendering = [];
            for (const model of this.collection.models) {
                const item = new this.ItemView({model});
                this._views[model.id] = item;
                rendering.push(item.render());
            }
            await Promise.all(rendering);
            this.$holder.html('');
            for (const item of Object.values(this._views)) {
                this.assertValidItem(item);
                const index = this.collection.indexOf(item.model);
                this._insertNode(item.el, index);
            }
            this.trigger("reset", Array.from(this._views));
        },

        _addItem: async function(item) {
            await item.render();
            this.assertValidItem(item);
            const index = this.collection.indexOf(item.model);
            this._insertNode(item.el, index);
            this.trigger("added", item);
            return item;
        },

        _removeItem: async function(item) {
            item.remove();
            this.trigger("removed", item);
            return item;
        },

        getItem: function(model) {
            return this._views[model.id];
        },

        getItems: function(model) {
            return Object.values(this._views);
        },

        assertValidItem: function(item) {
            if (item.$el.length !== 1) {
                item.remove();
                throw TypeError("ItemView MUST have exactly one root element");
            }
        }
    });
})();
