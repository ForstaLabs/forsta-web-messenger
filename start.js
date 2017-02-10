const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const serveStatic = require('serve-static');

const app = express();

app.use(morgan('dev'));
app.use(serveStatic('.', {
    index: ['inbox.html']
}));


var corsOptions = {
  origin: 'http://localhost:8000',
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}

app.options('*', cors(corsOptions));

app.listen(8000);
