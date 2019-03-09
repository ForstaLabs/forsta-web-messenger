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
            this.renderItem(item); // bg okay
            this._views[item.model.id] = item;
            const index = this.collection.indexOf(item.model);
            this.trigger("adding", item);
            this._insertNode(item.el, index);
            this.trigger("added", item);
            return item;
        },

        removeModel: function(model) {
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
            this.trigger("removing", item);
            delete this._views[model.id];
            item.remove();
            this.trigger("removed", item);
            return item;
        },

        repositionModel: function(model, index) {
            // Must be manually triggered by the collection attached to this view.
            const node = this._views[model.id].el;
            if (node !== this._holder.childNodes[index]) {
                this._holder.removeChild(node);
                this._insertNode(node, index);
            }
        },

        resetCollection: function() {
            for (const x of Object.values(this._views)) {
                x.remove();
            }
            this._views = {};
            this.$holder.empty();
            let i = 0;
            const items = [];
            console.debug(`ListView reset of ${this.collection.models.length} items:`, this);
            console.warn("START INSERT", this.cid);
            for (const model of this.collection.models) {
                const item = new this.ItemView({model, listView: this});
                item.el.dataset.modelCid = item.model.cid;
                this._views[item.model.id] = item;
                this.renderItem(item);
                this._insertNode(item.el, i++);
                items.push(item);
            }
            this._loaded = true;
            this.trigger("reset", items);
            Promise.all(items.map(x => x.rendered)).then(() => {
                for (const x of items) {
                    //this._insertNode(x.el, items.indexOf(x));
                }
                console.warn("DONE", this.cid, performance.now());
            });
        },

        renderItem: async function(item) {
            await item.render();
            this.assertValidItem(item);
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

        indexOf: function(model) {
            const view = this.getItem(model);
            return Array.from(this._holder.childNodes.values()).indexOf(view.el);
        },

        assertValidItem: function(item) {
            if (item.$el.length !== 1) {
                item.remove();
                throw TypeError("ItemView MUST have exactly one root element");
            }
        }
    });
})();
