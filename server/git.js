/*
 * Make git-rev async friendly.
 */

const git = require('git-rev');
const funcs = ['short', 'long', 'branch', 'tag'];

for (const f of funcs) {
    exports[f] = async function() {
        return new Promise((resolve, reject) => {
            try {
                git[f](resolve);
            } catch(e) {
                reject(e);
            }
        });
    };
}
