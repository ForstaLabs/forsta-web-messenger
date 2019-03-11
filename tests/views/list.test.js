
const util = require('../util');

describe('Basic Framework', () => {
    beforeAll(util.pageEvaluateDeps);

    it('can parse scripts', async () => {
        await util.pageEvaluate('app/views/list.js');
    });
});
