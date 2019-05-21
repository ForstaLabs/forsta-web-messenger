/* global Backbone */

const util = require('../util');

describe('ListView tests', () => {
    beforeAll(async () => {
        await util.pageSetup();
        await page.addScriptTag({path: 'app/views/base.js'});
        await page.addScriptTag({path: 'app/views/list.js'});
    });

    it('exists', async () => {
        const exists = await page.evaluate(() => !!F.ListView);
        expect(exists).toBe(true);
    });

    it('can be instantiated', async () => {
        await page.evaluate(() => {
            new F.ListView({});
        });
    });

    it('can render', async () => {
        await page.evaluate(async () => {
            const collection = new Backbone.Collection();
            collection.add([{id: 1}, {id: 2}, {id: 3}]);
            const view = new F.ListView({collection});
            await view.render();
            if (view.getItems().length !== 3) {
                throw new Error('expected 3 items to render');
            }
            await view.attachingItems;
            for (const item of view.getItems()) {
                if (!view.$(item.$el).length) {
                    throw new Error("Item not added to DOM");
                }
            }
        });
    });

    it('can handle sync nosuper item render', async () => {
        await page.evaluate(async () => {
            const ItemView = F.View.extend({
                render: () => 'nothing doing'
            });
            const collection = new Backbone.Collection();
            collection.add([{id: 1}, {id: 2}, {id: 3}]);
            const view = new F.ListView({collection, ItemView});
            await view.render();
            if (view.getItems().length !== 3) {
                throw new Error('expected 3 items to render');
            }
            await view.attachingItems;
            for (const item of view.getItems()) {
                if (!view.$(item.$el).length) {
                    throw new Error("Item not added to DOM");
                }
            }
        });
    });

    it('can handle async nosuper item render', async () => {
        await page.evaluate(async () => {
            const ItemView = F.View.extend({
                render: async () => { await F.sleep(0.001); }
            });
            const collection = new Backbone.Collection();
            collection.add([{id: 1}, {id: 2}, {id: 3}]);
            const view = new F.ListView({collection, ItemView});
            await view.render();
            if (view.getItems().length !== 3) {
                throw new Error('expected 3 items to render');
            }
            await view.attachingItems;
            for (const item of view.getItems()) {
                if (!view.$(item.$el).length) {
                    throw new Error("Item not added to DOM");
                }
            }
        });
    });

    it('can handle sync exception during item render', async () => {
        await page.evaluate(async () => {
            let i = 0;
            const ItemView = F.View.extend({
                render: function() {
                    if (i++ === 1) {
                        this.threw = true;
                        throw new Error("boom");
                    }
                }
            });
            const collection = new Backbone.Collection();
            collection.add([{id: 1}, {id: 2}, {id: 3}]);
            const view = new F.ListView({collection, ItemView});
            await view.render();
            if (view.getItems().length !== 3) {
                throw new Error('expected 3 items to render');
            }
            await view.attachingItems;
            for (const item of view.getItems()) {
                if (!view.$(item.$el).length) {
                    throw new Error("Item not added to DOM");
                }
            }
        });
    });

    it('can handle async exception during item render', async () => {
        await page.evaluate(async () => {
            let i = 0;
            const ItemView = F.View.extend({
                render: async function() {
                    if (i++ === 1) {
                        await F.sleep(0.01);
                        this.threw = true;
                        throw new Error("boom");
                    }
                }
            });
            const collection = new Backbone.Collection();
            collection.add([{id: 1}, {id: 2}, {id: 3}]);
            const view = new F.ListView({collection, ItemView});
            await view.render();
            if (view.getItems().length !== 3) {
                throw new Error('expected 3 items to render');
            }
            await view.attachingItems;
            for (const item of view.getItems()) {
                if (!view.$(item.$el).length) {
                    throw new Error("Item not added to DOM");
                }
            }
        });
    });

});
