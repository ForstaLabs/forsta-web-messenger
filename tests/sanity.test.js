/* global page describe beforeAll expect it */

const util = require('./util');

describe('Sanity Tests', () => {
    beforeAll(util.pageSetup);

    it('can parse main script', async () => {
        await page.addScriptTag({path: 'dist/static/js/app/main.js'});
    });

    it('can parse embed script', async () => {
        await page.addScriptTag({path: 'dist/static/js/app/embed.js'});
    });

    it('can parse signin script', async () => {
        await page.addScriptTag({path: 'dist/static/js/app/signin.js'});
    });
});
