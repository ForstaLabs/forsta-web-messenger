/*
 * Simple (mostly) static file server for the web app.
 */
const express = require('express');
const morgan = require('morgan');
const process = require('process');
const os = require('os');
const build = require('../dist/build.json');

const PORT = Number(process.env.PORT) || 1080;
const CCSM_URL = process.env.RELAY_CCSM_URL || 'https://ccsm-dev.forsta.io';
const REDIRECT_INSECURE = process.env.RELAY_REDIRECT_INSECURE === '1';
const TEXTSECURE_URL = process.env.TEXTSECURE_URL || 'https://textsecure.forsta.services';
const ATTACHMENTS_S3_URL = process.env.ATTACHMENTS_S3_URL || 'https://forsta-relay.s3.amazonaws.com';


const env_clone = [
    'SUPERMAN_NUMBER',
    'SENTRY_DSN',
    'SENTRY_USER_ERROR_FORM',
    'STACK_ENV',
];


async function main() {
    const env = {};
    for (const key of env_clone) {
        env[key] = process.env[key] || null;
    }
    for (const key of Object.keys(build)) {
        env[key.toUpperCase()] = build[key];
    }
    env.SERVER_HOSTNAME = os.hostname();
    env.SERVER_PLATFORM = os.platform();
    if (process.env.FIREBASE_CONFIG) {
        env.FIREBASE_CONFIG = JSON.parse(process.env.FIREBASE_CONFIG);
    }
    env.TEXTSECURE_URL = TEXTSECURE_URL;
    env.ATTACHMENTS_S3_URL = ATTACHMENTS_S3_URL;

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
    atRouter.get('/@worker-service.js', (req, res) => res.sendFile('static/js/worker/service.js', {root}));
    atRouter.get(['/@', '/@/*'], (req, res) => res.sendFile('html/main.html', {root}));
    atRouter.all('/@*', (req, res) => res.status(404).send(`File Not Found: "${req.path}"\n`));
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
