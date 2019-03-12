/* global page describe beforeAll expect it */


const staticPath = 'dist/static/js';


async function pageEvaluate(path) {
    //const code = fs.readFileSync(path, 'utf8');
    try {
        //return await page.evaluate(`document.currentScript = document.createElement('script');` + code);
        await page.addScriptTag({path});
    } catch(e) {
        debugger;
        throw e;
    }
}

async function pageSetup() {
    await page.evaluate(() => {
        self.F = self.F || {};
        self.F.env = {
            GIT_COMMIT: 'testing'
        };
    });
    await page.addScriptTag({path: staticPath + '/app/deps.js'});
    await page.addScriptTag({path: staticPath + '/lib/signal.js'});
    await page.addScriptTag({path: staticPath + '/lib/relay.js'});
    //await pageEvaluate(staticPath + '/app/deps.js');
    //await pageEvaluate(staticPath + '/lib/signal.js');
    //await pageEvaluate(staticPath + '/lib/relay.js');
}


module.exports = {
    pageSetup,
    pageEvaluate,
};
