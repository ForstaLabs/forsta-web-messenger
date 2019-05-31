// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};
    const logger = F.log.getLogger('list-view');

    /*
    * Generic list view that watches a given collection, wraps its members in
    * a given child view and adds the child view elements to its own element.
    */
    F.ListView = F.View.extend({
        ItemView: F.View,
        holder: undefined, // default to self

        initialize: function(options) {
            this.reverse = options.reverse;
            if (options.ItemView) {
                this.ItemView = options.ItemView;
            }
            this._items = [];
            this._itemsMapping = new Map();
            this.attachingItems = Promise.resolve();
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
            if (!this._listening) {
                this.listenTo(this.collection, 'add', this.onCollectionAdd);
                this.listenTo(this.collection, 'remove', this.onCollectionRemove);
                this.listenTo(this.collection, 'reposition', this.onCollectionReposition);
                this.listenTo(this.collection, 'sort', this.onCollectionSort);
                this.listenTo(this.collection, 'reset', this.onCollectionReset);
                this._listening = true;
            }
            await this.onCollectionReset();
            return this;
        },

        remove: function() {
            F.View.prototype.remove.apply(this, arguments);
            for (const v of this._items) {
                v.remove();
            }
            this._items.length = 0;
            this._itemsMapping.clear();
        },

        onCollectionAdd: function(model) {
            F.assert(!this._itemsMapping.has(model.id), "Model already added");
            const item = new this.ItemView({model, listView: this});
            this.trigger("adding", item);
            this.addItem(item).then(() => this.trigger("added", item));
            return item;
        },

        onCollectionRemove: function(model) {
            const item = this._itemsMapping.get(model.id);
            F.assert(item, "Model not found");
            this.trigger("removing", item);
            this.removeItem(item);
            this.trigger("removed", item);
            return item;
        },

        onCollectionSort: function() {
            const before = this.getItems();
            this._sortItems();
            const items = this.getItems();
            if (items.every((x, i) => before[i] === x)) {
                return;
            }
            // Reorder from tail to head...
            for (let i = items.length - 2; i >= 0; i--) {
                if (!this.isAttached(items[i])) {
                    continue;
                }
                const node = items[i].el;
                if (node.nextSibling !== items[i + 1].el) {
                    // Seek forward for next attached sibling...
                    let inserted;
                    for (let ii = i + 1; ii < items.length; ii++) {
                        if (this.isAttached(items[ii])) {
                            this._holder.insertBefore(node, items[ii].el);
                            inserted = true;
                            break;
                        }
                    }
                    if (!inserted) {
                        this._holder.appendChild(node);
                    }
                }
            }
        },

        onCollectionReset: function() {
            for (const x of this._items) {
                x.remove();
            }
            this._items.length = 0;
            this._itemsMapping.clear();
            this.$holder.empty();
            const attachments = [];
            for (const model of this.collection.models) {
                const item = new this.ItemView({model, listView: this});
                // Monitor attachments, but ignore DOM attach exceptions.
                attachments.push(this.addItem(item).catch(e => {
                    logger.warn("Failed to add item:", e);
                }));
            }
            Promise.all(attachments).then(items => this.trigger("reset", items));
        },

        addItem: function(item, options) {
            /* The item view is logically added to our set of children views.
             * It is immediately available via `getItem()` but the attachment
             * of the item's DOM node is deferred until a sensible time for
             * attachment to avoid layout thrashing.  The return value of this
             * function is a Promise that resolves when the item is rendered
             * and the element of this view is added as a child to our DOM node.
             * Note that if the item fails to render or fails to attach to the
             * DOM for some reason the Promise will still resolve successfully.
             */
            options = options || {};
            F.assert(!this._itemsMapping.has(item.model.id), "Item already added to list view");
            item.el.dataset.modelCid = item.model.cid;
            this._itemsMapping.set(item.model.id, item);
            const index = this.collection.indexOf(item.model);
            this._items.splice(index, null, item);
            return this._schedAttachment(item);
        },

        _schedAttachment: function(item) {
            const running = !!this._attachmentPending;
            if (!running) {
                this.attachingItems = new Promise(resolve => this._setAttachingItemsDone = resolve);
                this._attachmentPending = new Map();
                this._attachmentReady = [];
            }
            const entry = {item};
            const attachPromise = new Promise((resolve, reject) => {
                entry.attachResolve = resolve;
                entry.attachReject = reject;
            });
            let renderPromise;
            try {
                const r = item.render();
                renderPromise = (r instanceof Promise) ? r : Promise.resolve(r);
            } catch(e) {
                renderPromise = Promise.reject(e);
            }
            this._attachmentPending.set(item, entry); // probably move up
            entry.renderFinally = renderPromise.catch(e => {
                // NOTE, we eat the exception and continue.  The view might
                // recover from the render error (e.g. networking issues, etc).
                logger.error("ListView item render error:", item, e);
            }).then(() => {
                // Must check in case we were removed via `removeItem` while waiting.
                if (this._attachmentPending.has(item)) {
                    this._attachmentReady.push(item);
                } else {
                    logger.warn("Not attaching non-pending (likely removed) item:", item);
                }
            });
            if (!running) {
                this._attachmentExecutor();
            }
            return attachPromise;
        },

        _layoutBudget: function() {
            // Return number of milliseconds we should budget for layout.  E.g. how long we
            // should wait for rendering jobs to finish before forcing a layout.  The basic
            // idea is that if there is a lot of rendering in the pipeline we should wait
            // longer so we can do fewer (but larger) DOM manipulations.
            //
            // Figures are ms unless otherwise noted.
            const itemLayoutCost = 10;
            const highWater = 5000;
            const lowWater = 400;
            const rendering = this._attachmentPending.size - this._attachmentReady.length;
            return Math.max(lowWater, Math.min(highWater, rendering * itemLayoutCost));
        },

        _attachmentExecutor: async function() {
            // Batch layout into chunks to prevent layout thrashing.  Huge perf gains from this.
            const pending = this._attachmentPending;
            const ready = this._attachmentReady;
            while (pending.size || ready.length) {
                const start = Date.now();
                for (let elapsed = 0;
                     ready.length < pending.size && elapsed < this._layoutBudget();
                     elapsed = Date.now() - start) {
                    const allRendered = Promise.all(Array.from(pending.values()).map(x => x.renderFinally));
                    const remaining = this._layoutBudget() - elapsed;
                    await Promise.race([allRendered, F.sleep(remaining / 1000)]);
                }
                if (!ready.length) {
                    continue;  // Max pause reached but nothing is ready...
                }
                for (const item of ready) {
                    const pendingEntry = pending.get(item);
                    try {
                        this._attachItem(item);
                        pendingEntry.attachResolve(item);
                    } catch(e) {
                        // This is a software bug, but it's too impactful to
                        // just throw from here.  Maybe someday we can remove
                        // this.
                        logger.error("Failed to attach item to DOM:", e);
                        pendingEntry.attachReject(e);
                    }
                    pending.delete(item);
                }
                ready.length = 0;
            }
            this._attachmentPending = null;
            this._attachmentReady = null;
            this._setAttachingItemsDone();
        },

        _attachItem: function(item) {
            F.assert(this._itemsMapping.has(item.model.id), 'List item not part of ListView');
            const items = this.getItems();
            const index = items.indexOf(item);
            F.assert(index !== -1, 'Item index is invalid in ListView');
            F.assert(!this.isAttached(item), 'List item is already attached');
            if (index === items.length - 1) {
                this._holder.appendChild(item.el);
                return;
            }
            for (let i = index + 1; i < items.length; i++) {
                if (this.isAttached(items[i])) {
                    this._holder.insertBefore(item.el, items[i].el);
                    return;
                }
            }
            this._holder.appendChild(item.el);
        },

        _sortItems: function() {
            this._items.sort((a, b) => {
                const posA = this.collection.indexOf(a.model);
                const posB = this.collection.indexOf(b.model);
                return posA < posB ? -1 : 1;
            });
        },

        removeItem: function(item) {
            item.remove();
            this._itemsMapping.delete(item.model.id);
            this._items.splice(this._items.indexOf(item), 1);
            if (this._attachmentPending) {
                const pending = this._attachmentPending.get(item);
                if (pending) {
                    pending.attachReject(new Error("Removed Before Attachment"));
                    this._attachmentPending.delete(item);
                    this._attachmentReady.splice(this._attachmentReady.indexOf(item), 1);
                }
            }
        },

        getItem: function(model) {
            return this._itemsMapping.get(model.id);
        },

        getItems: function() {
            // Return a copy of view items in view order, not model order.
            const items = Array.from(this._items);
            return this.reverse ? items.reverse() : items;
        },

        indexOf: function(view) {
            // Return the view based index (e.g. flipped if view is reverse ordered).
            const items = this.getItems();
            return items.indexOf(view);
        },

        isAttached: function(view) {
            return view.el.parentNode === this._holder;
        }
    });
})();
