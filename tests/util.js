/* global page */


async function pageSetup() {
    // Note: we must navigate to a valid URL to enable apis like IndexedDB.
    await page.goto('http://localhost:10800/@version.json');
    await page.addScriptTag({url: '/@env.js'});
    await page.addScriptTag({url: '/@static/js/app/deps.js'});
    await page.addScriptTag({url: '/@static/semantic/semantic.js'});
    await page.addScriptTag({url: '/@static/js/lib/signal.js'});
    await page.addScriptTag({url: '/@static/js/lib/relay.js'});
}


module.exports = {
    pageSetup
};
