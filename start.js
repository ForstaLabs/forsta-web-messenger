const express = require('express');
const morgan = require('morgan');
const serveStatic = require('serve-static');
const process = require('process');

const PORT = Number(process.env.PORT) || 8000;

const app = express();

app.use(morgan('dev'));
app.use(serveStatic('.', {
    index: ['inbox.html']
}));

app.listen(PORT);
