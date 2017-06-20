/*
 * Simple (mostly) static file server for the web app.
 */
const express = require('express');
const morgan = require('morgan');
const process = require('process');
const git = require('./git');

const PORT = Number(process.env.PORT) || 1080;
const CCSM_URL = process.env.RELAY_CCSM_URL;
const REDIRECT_INSECURE = process.env.RELAY_REDIRECT_INSECURE === '1';

const dist = `${__dirname}/../dist`;

const env_clone = [
    'ANDROID_APP_URL',
    'IOS_APP_URL',
    'SUPERMAN_NUMBER'
];


async function main() {
    const env = {};
    for (const x of env_clone) {
        env[x] = process.env[x];
    }
    env.GIT_COMMIT = await git.long();
    env.GIT_BRANCH = await git.branch();
    env.GIT_TAG = await git.tag();

    const app = express();
    app.use(morgan('dev')); // logging

    if (REDIRECT_INSECURE) {
        console.warn('Forcing HTTPS usage');
        app.use((req, res, next) => {
            if (req.get('x-forwarded-proto') === 'https' || req.secure) {
                next();
            } else {
                return res.redirect(`https://${req.get('host')}${req.url}`);
            }
        });
    }

    const siteRouter = express.Router();
    siteRouter.get('/env.js', (req, res) => {
        res.send(`window.forsta_env = ${JSON.stringify(env)}`);
    });
    siteRouter.use('/static', express.static(`${dist}/static`, {
        strict: true,
    }));
    siteRouter.use('/', express.static(`${dist}/html`, {
        strict: true,
        fallthrough: false, // See below...
        extensions: ['html'],
        index: ['main.html']
    }));
    /* ^^^ Ensure fallthrough = false on last entry ^^^ */
    app.use(['/m'], siteRouter);


    const convoRouter = express.Router();
    convoRouter.get('/env.js', (req, res) => {
        res.send(`window.forsta_env = ${JSON.stringify(env)}`);
    });
    convoRouter.use('/static', express.static(`${dist}/static`, {
        strict: true,
    }));
    convoRouter.use('/templates', express.static(`${dist}/html/templates`, {
        strict: true,
    }));
    convoRouter.use((req, res) => res.sendFile('main.html', {
        root: `${dist}/html`
    }));
    app.use(['/c'], convoRouter);

    if (CCSM_URL) {
        console.warn(`Proxying CCSM traffic to: ${CCSM_URL}`);
        const proxy = require('http-proxy').createProxyServer({
            target: CCSM_URL,
            changeOrigin: true
        })
        app.all(['/*'], function(req, res) {
            return proxy.web.apply(proxy, arguments);
        });
    }

    app.listen(PORT);
}

main();
