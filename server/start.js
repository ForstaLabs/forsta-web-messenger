/*
 * Simple (mostly) static file server for the web app.
 */
const build = require('../dist/build.json');
const express = require('express');
const fs = require('fs');
const morgan = require('morgan');
const os = require('os');
const process = require('process');

let _rejectCount = 0;
process.on('unhandledRejection', ev => {
    console.error(ev);
    if (_rejectCount++ > 100) {
        console.error("Reject count too high, killing process.");
        process.exit(1);
    }
});

const PORT = Number(process.env.PORT) || 1080;
const CCSM_URL = process.env.RELAY_CCSM_URL;
const REDIRECT_INSECURE = process.env.RELAY_REDIRECT_INSECURE === '1';
const TEXTSECURE_URL = process.env.TEXTSECURE_URL;
const DEVMODE = process.env.NODE_ENV !== 'production';


const env_clone = [
    'SUPERMAN_NUMBER',
    'SENTRY_DSN',
    'SENTRY_USER_ERROR_FORM',
    'STACK_ENV',
    'CCSM_API_URL',
    'RESET_CACHE'
];


const _tplCache = new Map();
async function renderSimpleTemplate(filename, options, finish) {
    /* Extremely simple template "engine". */
    const subs = options.subs;
    const cacheKey = JSON.stringify([filename, subs]);
    if (DEVMODE || !_tplCache.has(cacheKey)) {
        _tplCache.set(cacheKey, new Promise((resolve, reject) => {
            try {
                fs.readFile(filename, (error, content) => {
                    if (error) {
                        return reject(error);
                    } else {
                        let output = content.toString();
                        for (const [key, value] of Object.entries(subs)) {
                            output = output.replace(new RegExp(`{{${key}}}`, 'g'), value);
                        }
                        resolve(output);
                    }
                });
            } catch(e) {
                reject(e);
            }
        }));
    }
    try {
        finish(/*error*/ null, await _tplCache.get(cacheKey));
    } catch(e) {
        finish(e);
    }
}


async function main() {
    const root = `${__dirname}/../dist`;
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

    const app = express();
    app.use(morgan('dev')); // logging
    app.engine('tpl', renderSimpleTemplate);
    app.disable('view cache');
    app.set('views', root + '/html');
    app.set('view engine', 'tpl');

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

    const subs = {
        version: env.GIT_COMMIT.substring(0, 8)
    };
    const cacheDisabled = 'no-cache, no-store, must-revalidate';
    const cacheEnabled = 'public, max-age=31536000, s-maxage=86400';
    const atRouter = express.Router();
    atRouter.use('/@static', express.static(`${root}/static`, {
        strict: true,
        cacheControl: false,
        setHeaders: res => res.setHeader('Cache-Control', cacheEnabled)
    }));
    atRouter.get('/@env.js', (req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.send(`self.F = self.F || {}; F.env = ${JSON.stringify(env)};\n`);
    });
    atRouter.get('/@worker-service.js', (req, res) => {
        res.setHeader('Cache-Control', cacheDisabled);
        res.sendFile('static/js/worker/service.js', {root})
    });
    atRouter.get('/@install', (req, res) => {
        res.setHeader('Cache-Control', cacheDisabled);
        res.render('install', {subs});
    });
    atRouter.get(['/@', '/@/*'], (req, res) => {
        res.setHeader('Cache-Control', cacheDisabled);
        res.render('main', {subs});
    });
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
