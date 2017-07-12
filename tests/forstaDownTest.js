
function main() {
  const fd = require('../lib/forstadown.js');
  const json = require('./data.json');
  for (let i = 0 ; i < json.length ; i++) {
      let out = fd.inlineConvert(fd.blockConvert(json[i].input), new Set(["body"]));
      if (out !== json[i].expected) {
        console.log();
        console.log(`Test (${json[i].name}) FAILED`);
        console.log(`Expected: ${json[i].expected}`);
        console.log(`Output: ${out}`);
        console.log("Exiting...");
        console.log();
        process.exit(-1);
      } else {
        console.log(`Test (${json[i].name}) Passed`);
      }
  }
}

main();
