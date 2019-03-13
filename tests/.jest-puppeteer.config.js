const headless = !(new Set(['false', '0', 'no', 'n'])).has(process.env.HEADLESS);

module.exports = {
    server: {
        command: 'PORT=10800 npm start',
        port: 10800
    },
    launch: {
        headless,
        devtools: !headless
    }
};
