/* global page describe beforeAll expect it */

const util = require('./util');

describe('Basic Framework', () => {
    beforeAll(util.pageEvaluateDeps);

    it('can parse main script', async () => {
        await util.pageEvaluate('dist/static/js/app/main.js');
    });

    it('can parse embed script', async () => {
        await util.pageEvaluate('dist/static/js/app/embed.js');
    });

    it('can parse signin script', async () => {
        await util.pageEvaluate('dist/static/js/app/signin.js');
    });
});
