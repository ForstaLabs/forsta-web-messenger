const express = require('express');
const morgan = require('morgan');
const serveStatic = require('serve-static');
const process = require('process');

const PORT = Number(process.env.PORT) || 8000;
const app = express();
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


app.use(morgan('dev'));
app.use(serveStatic(root, {
    index: ['inbox.html']
}));

app.get('/env.js', function(req, res) {
    res.send(`window.forsta_env = ${JSON.stringify(env)}`);
});

app.listen(PORT);
