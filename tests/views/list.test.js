
const util = require('../util');

describe('Basic Framework', () => {
    beforeAll(util.pageSetup);

    it('can parse scripts', async () => {
        await util.pageEvaluate('app/views/list.js');
    });

    it('can extend', async () => {
        await util.pageEvaluate('app/views/list.js');
        //await page.evaluate(async () => {
        //    const TestListView = F.ListView.extend({
        //    });
        //    console.log(TestListView);
        //});
    }, 10000000);
});
