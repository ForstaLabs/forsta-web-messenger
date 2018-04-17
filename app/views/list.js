// vim: ts=4:sw=4:expandtab

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
            // Views are async; We have to queue ALL state changes to avoid races.
            return F.queueAsync(this, this._addModel.bind(this, model));
        },

        _addModel: async function(model) {
            if (!this._loaded) {
                /* Will self-heal via render() -> resetCollection() */
                console.warn("Dropping premature addModel request for:", model);
                return;
            }
            if (this._views[model.id]) {
                console.error("Model already added:", model);
                throw new TypeError("Model Exists");
            }
            const item = new this.ItemView({model, listView: this});
            item.el.dataset.modelCid = item.model.cid;
            await item.render();
            this.assertValidItem(item);
            this._views[item.model.id] = item;
            const index = this.collection.indexOf(item.model);
            this._insertNode(item.el, index);
            this.trigger("added", item);
            return item;
        },

        removeModel: function(model) {
            // Views are async; We have to queue ALL state changes to avoid races.
            return F.queueAsync(this, this._removeModel.bind(this, model));
        },

        _removeModel: function(model) {
            const item = this._views[model.id];
            if (!item) {
                if (!this._loaded) {
                    /* Will self-heal via render() -> resetCollection() */
                    console.warn("Dropping premature removeModel request for:", model);
                    return;
                }
                console.error("Model not found:", model);
                throw new ReferenceError("Model Not Found");
            }
            delete this._views[model.id];
            item.remove();
            this.trigger("removed", item);
            return item;
        },

        repositionModel: function(model, newIndex) {
            // Must be manually triggered by the collection attached to this view.
            // Views are async; We have to queue ALL state changes to avoid races.
            return F.queueAsync(this, this._repositionModel.bind(this, model, newIndex));
        },

        _repositionModel: async function(model, index) {
            const node = this._views[model.id].el;
            if (node !== this._holder.childNodes[index]) {
                this._holder.removeChild(node);
                this._insertNode(node, index);
            }
        },

        resetCollection: function() {
            // Views are async; We have to queue ALL state changes to avoid races.
            return F.queueAsync(this, this._resetCollection.bind(this));
        },

        _resetCollection: async function() {
            Object.values(this._views).map(x => x.remove());
            this._views = {};
            const rendering = [];
            for (const model of this.collection.models) {
                const item = new this.ItemView({model, listView: this});
                item.el.dataset.modelCid = item.model.cid;
                rendering.push(item.render().catch(e => {
                    console.error("Item render error:", e);
                    item.remove();
                }));
            }
            const items = (await Promise.all(rendering)).filter(x => x);
            this.$holder.html('');
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                this.assertValidItem(item);
                this._views[item.model.id] = item;
                this._insertNode(item.el, i);
            }
            this._loaded = true;
            this.trigger("reset", items);
        },

        _insertNode: function(node, index) {
            if (this.reverse) {
                index = this._holder.childNodes.length - index;
            }
            const afterNode = this._holder.childNodes[index];
            // Note that these DOM methods will move the node if it's currently attached.
            if (!afterNode) {
                this._holder.appendChild(node);
            } else {
                this._holder.insertBefore(node, afterNode);
            }
        },

        getItem: function(model) {
            return this._views[model.id];
        },

        getItems: function() {
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
