/*
 * Simple (mostly) static file server for the web app.
 */
const express = require('express');
const morgan = require('morgan');
const process = require('process');
const git = require('./git');
const os = require('os');

const PORT = Number(process.env.PORT) || 1080;
const CCSM_URL = process.env.RELAY_CCSM_URL;
const REDIRECT_INSECURE = process.env.RELAY_REDIRECT_INSECURE === '1';


const env_clone = [
    'ANDROID_APP_URL',
    'IOS_APP_URL',
    'SUPERMAN_NUMBER',
    'SENTRY_DSN',
];


async function main() {
    const env = {};
    for (const x of env_clone) {
        env[x] = process.env[x];
    }
    env.GIT_COMMIT = await git.long();
    env.GIT_BRANCH = await git.branch();
    env.GIT_TAG = await git.tag();
    env.SERVER_HOSTNAME = os.hostname();
    env.SERVER_PLATFORM = os.platform();
    if (process.env.FIREBASE_CONFIG) {
        env.FIREBASE_CONFIG = JSON.parse(process.env.FIREBASE_CONFIG);
    }

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

    const root = `${__dirname}/../dist`;
    const atRouter = express.Router();
    atRouter.use('/@static', express.static(`${root}/static`, {strict: true}));
    atRouter.get('/@env.js', (req, res) => {
        res.send(`forsta_env = ${JSON.stringify(env)};\n`);
    });
    atRouter.get('/@install', (req, res) => res.sendFile('html/install.html', {root}));
    atRouter.get('/@register', (req, res) => res.sendFile('html/register.html', {root}));
    atRouter.get(['/@', '/@/*'], (req, res) => res.sendFile('html/main.html', {root}));
    atRouter.all('/@*', (req, res) => res.status(404).send('File Not Found\n'));
    app.use(atRouter);

    if (CCSM_URL) {
        console.warn(`Proxying CCSM traffic to: ${CCSM_URL}`);
        const proxy = require('http-proxy').createProxyServer({
            target: CCSM_URL,
            changeOrigin: true
        })
        app.all(['/*'], function(req, res) {
            console.log('CCSM Proxy:', req.path);
            return proxy.web.apply(proxy, arguments);
        });
    }

    app.listen(PORT);
}

main();
