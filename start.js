const express = require('express');
const morgan = require('morgan');
const serveStatic = require('serve-static');
const process = require('process');

const PORT = Number(process.env.PORT) || 1080;
const env_clone = [
    'ANDROID_APP_URL',
    'IOS_APP_URL',
    'SUPERMAN_NUMBER'
];
const env = {};
for (const x of env_clone) {
    env[x] = process.env[x];
}
const root = process.env.DEVMODE === "1" ? '.' : 'dist';

const app = express();
app.use(morgan('dev'));
const siteRouter = express.Router();
siteRouter.use(serveStatic(root, {
    index: ['inbox.html']
}));
siteRouter.get('/env.js', function(req, res) {
    res.send(`window.forsta_env = ${JSON.stringify(env)}`);
});

app.use(['/m', '/m/*'], siteRouter);
if (process.env.RELAY_CCSM_EMBED === "1") {
    if (!process.env.RELAY_CCSM_URL) {
        throw new Error("RELAY_CCSM_URL must be set for ccsm embedding");
    }
    const httpProxy = require('http-proxy');
    const proxy = httpProxy.createProxyServer({
        target: process.env.RELAY_CCSM_URL,
        changeOrigin: true
    })
    app.all(['/*'], function (req, res) {
        proxy.web(req, res);
    });
}
app.listen(PORT);
