/* global page describe beforeAll expect it */

const util = require('./util');

describe('Basic Framework', () => {
    beforeAll(util.pageAddDeps);

    it('can parse main script', async () => {
        await util.pageEvaluate('dist/static/js/app/main.js');
    }, 100000000);

    it('can parse embed script', async () => {
        await util.pageEvaluate('dist/static/js/app/embed.js');
    }, 100000000);

    it('can parse signin script', async () => {
        await util.pageEvaluate('dist/static/js/app/signin.js');
    }, 1000000000);
});
