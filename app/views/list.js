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
            /* Because our Views are async we have to queue adding models
             * to avoid races. */
            return F.queueAsync(this, this._addModel.bind(this, model));
        },

        removeModel: function(model) {
            return F.queueAsync(this, this._removeModel.bind(this, model));
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
            this._insertNode(node, newIndex);
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
            this.$holder.html('');
            for (const model of this.collection.models) {
                await this._addModel(model);
            }
        },

        _addModel: async function(model) {
            const item = new this.ItemView({model: model});
            await item.render();
            if (item.$el.length !== 1) {
                item.remove();
                throw TypeError("ItemView MUST have exactly one root element");
            }
            this._views[model.id] = item;
            const index = this.collection.indexOf(model);
            this._insertNode(item.el, index);
        },

        _removeModel: async function(model) {
            const item = this._views[model.id];
            delete this._views[model.id];
            item.remove();
        }
    });
})();
