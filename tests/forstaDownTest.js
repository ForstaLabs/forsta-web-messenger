
function main() {
    const fd = require('../lib/forstadown.js');
    const json = require('./data.json');
    for (let i = 0 ; i < json.length ; i++) {
        let out = fd.inlineConvert(fd.blockConvert(json[i].input), new Set(["body"]));
        if (out !== json[i].expected) {
            console.error(`\nFAILED TEST ${i}: ${json[i].name}`);
            console.error(`  Expected: "${json[i].expected}"`);
            console.error(`  Actual  : "${out}"`);
            process.exit(-1);
        } else {
            console.info(`PASSED TEST ${i}: ${json[i].name}`);
        }
    }
}

main();
