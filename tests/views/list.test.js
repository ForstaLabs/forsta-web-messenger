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
        });
    });
});
