/*
 * Simple (mostly) static file server for the web app.
 */
const express = require('express');
const morgan = require('morgan');
const serveStatic = require('serve-static');
const process = require('process');

const PORT = Number(process.env.PORT) || 1080;
const CCSM_URL = process.env.RELAY_CCSM_URL;
const REDIRECT_INSECURE = process.env.RELAY_REDIRECT_INSECURE === '1';

const dist = `${__dirname}/../dist`;

const env_clone = [
    'ANDROID_APP_URL',
    'IOS_APP_URL',
    'SUPERMAN_NUMBER'
];
const env = {};
for (const x of env_clone) {
    env[x] = process.env[x];
}


const app = express();
app.use(morgan('common')); // logging

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
siteRouter.use(serveStatic(`${dist}/html`, {
    extensions: ['html'],
    index: ['main.html']
}));
siteRouter.use('/static', serveStatic(`${dist}/static`));
siteRouter.get('/env.js', (req, res) => {
    res.send(`window.forsta_env = ${JSON.stringify(env)}`);
});
app.use(['/m'], siteRouter);

if (CCSM_URL) {
    console.warn(`Proxying CCSM traffic to: ${CCSM_URL}`);
    const proxy = require('http-proxy').createProxyServer({
        target: CCSM_URL,
        changeOrigin: true
    })
    app.all(['/*'], proxy.web.bind(proxy));
}

app.listen(PORT);
