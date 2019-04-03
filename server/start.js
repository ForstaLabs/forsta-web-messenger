/*
 * Simple (mostly) static file server for the web app.
 */
const build = require('../dist/build.json');
const express = require('express');
const fs = require('fs');
const morgan = require('morgan');
const os = require('os');
const pkgVersion = require('../package.json').version;
const process = require('process');

let _rejectCount = 0;
process.on('unhandledrejection', ev => {
    console.error(ev);
    if (_rejectCount++ > 100) {
        console.error("Reject count too high, killing process.");
        process.exit(1);
    }
});

const PORT = Number(process.env.PORT) || 1080;
const SIGNAL_URL = process.env.SIGNAL_URL || 'https://signal.forsta.io';
const ATLAS_URL = process.env.ATLAS_URL || 'https://atlas.forsta.io';
const ATLAS_UI_URL = process.env.ATLAS_UI_URL || 'https://app.forsta.io';
const REDIRECT_INSECURE = process.env.RELAY_REDIRECT_INSECURE === '1';
const PROM_METRICS = process.env.PROM_METRICS === '1';
const DEVMODE = process.env.NODE_ENV !== 'production';
const RESET_CACHE = process.env.RESET_CACHE === '1';
const NO_MINIFY = process.env.NO_MINIFY === '1';

const env_clone = [
    'SUPERMAN_NUMBER',
    'SENTRY_DSN',
    'SENTRY_USER_ERROR_FORM',
    'STACK_ENV',
    'RESET_CACHE',
    'GOOGLE_ANALYTICS_UA',
    'NO_MINIFY',
    'DISCOVER_GOOGLE_AUTH_CLIENT_ID',
    'GOOGLE_MAPS_API_KEY',
    'SCREENSHARE_CHROME_EXT_ID',
    'HAS_AVATAR_SERVICE',
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
    const jsenv = {};
    for (const key of env_clone) {
        jsenv[key] = process.env[key] || null;
    }
    for (const key of Object.keys(build)) {
        jsenv[key.toUpperCase()] = build[key];
    }
    jsenv.SERVER_HOSTNAME = os.hostname();
    jsenv.SERVER_PLATFORM = os.platform();
    if (process.env.FIREBASE_CONFIG) {
        jsenv.FIREBASE_CONFIG = JSON.parse(process.env.FIREBASE_CONFIG);
    }
    jsenv.SIGNAL_URL = SIGNAL_URL;
    jsenv.ATLAS_URL = ATLAS_URL;

    const app = express();
    app.use(morgan(process.env.MORGAN_LOGGING || 'combined'));
    app.engine('tpl', renderSimpleTemplate);
    app.disable('view cache');
    app.set('views', root + '/html');
    app.set('view engine', 'tpl');
    app.set('trust proxy', true);

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
    if (PROM_METRICS) {
        const promBundle = require("express-prom-bundle");
        app.use(promBundle({includeMethod: true}));
    }

    console.log("Minified:", NO_MINIFY ? 'no' : 'YES');
    console.log("Reset Cache:", RESET_CACHE ? 'YES' : 'no');
    const minify_ext = NO_MINIFY ? '' : '.min';
    const subs = {
        version: jsenv.GIT_COMMIT.substring(0, 8),
        minify_ext,
    };
    const cacheDisabled = 'no-cache, no-store, must-revalidate';
    const cacheEnabled = RESET_CACHE ? cacheDisabled : 'public, max-age=31536000, s-maxage=900';
    const atRouter = express.Router();
    atRouter.use('/@static', express.static(`${root}/static`, {
        strict: true,
        cacheControl: false,
        setHeaders: res => res.setHeader('Cache-Control', cacheEnabled)
    }));
    atRouter.get('/@env.js', (req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        const reqenv = Object.assign({CLIENT_IP: req.ip}, jsenv);
        res.send(`self.F=self.F||{};F.env=${JSON.stringify(reqenv)};`);
    });
    atRouter.get('/@version.json', (req, res) => {
        res.setHeader('Cache-Control', cacheDisabled);
        res.json({version: pkgVersion});
    });
    atRouter.get('/@worker-service.js', (req, res) => {
        res.setHeader('Cache-Control', cacheDisabled);
        res.sendFile(`static/js/worker/service${minify_ext}.js`, {root});
    });
    atRouter.get('/@install', (req, res) => {
        res.setHeader('Cache-Control', cacheDisabled);
        res.render('install', {subs});
    });
    atRouter.get('/@signin', (req, res) => {
        res.setHeader('Cache-Control', cacheDisabled);
        res.render('signin', {subs});
    });
    atRouter.get('/@embed', (req, res) => {
        res.setHeader('Cache-Control', cacheDisabled);
        res.render('embed', {subs});
    });
    atRouter.get('/@chat/*', (req, res) => {
        res.setHeader('Cache-Control', cacheDisabled);
        res.render('chat', {subs});
    });
    atRouter.get('/health', (req, res) => {
        res.send('ok');
    });
    atRouter.get(['/@', '/@/*'], (req, res) => {
        res.setHeader('Cache-Control', cacheDisabled);
        res.render('main', {subs});
    });
    atRouter.all('/@*', (req, res) => res.status(404).send(`File Not Found: "${req.path}"\n`));
    app.use(atRouter);

    if (ATLAS_UI_URL) {
        console.warn(`Proxying Atlas UI traffic to: ${ATLAS_UI_URL}`);
        const proxy = require('http-proxy').createProxyServer({
            target: ATLAS_UI_URL,
            changeOrigin: true
        });
        app.all(['/*'], function(req, res) {
            console.log('Atlas UI Proxy:', req.path);
            return proxy.web.apply(proxy, arguments);
        });
    }

    app.listen(PORT);
}

main();
