/* global page describe beforeAll expect it */

const fs = require('fs');

const staticPath = 'dist/static/js';

exports.pageEvaluate = async function(path) {
    const code = fs.readFileSync(path);
    const script = `function foo() {${code}}`;
    return await page.evaluate(script);
};

exports.pageEvaluateDeps = async function() {
    await exports.pageEvaluate(staticPath + '/app/deps.js');
};
