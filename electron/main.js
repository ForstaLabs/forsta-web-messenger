'use strict';

const {app, BrowserWindow} = require('electron');
const path = require('path');
const url = require('url');

const menu = require('./menu')

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win = null;

function createWindow() {
    // Create the browser window.
    win = new BrowserWindow({ 
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            javascript: true,
            plugins: true,
            preload: __dirname + '/preload.js',
            experimentalFeatures: true
            // sandbox: true,
            // contextIsolation: true,
        }
    });

        // and load the index.html of the app
    win.loadURL(url.format({
        pathname: 'localhost:1080',
        protocol: 'http',
        // pathname: path.join(__dirname, 'index.html'),
        // protocol: 'file:',
        slashes: true
    }));

    // Open  the DevTools
    // win.webContents.openDevTools()

        // Emitted when the window is closed.
    win.on('closed', () => {
            // Dereference the window object, usually you would store windows
            // in an array if your app supports multi windows, this is the time
            // when you should delete the corresponding element.
        win = null;
    });
}

    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
app.on('ready', () => {

    // Setup and launch the local server
    process.env['RELAY_ATLAS_URL'] = 'https://app-dev.forsta.io';
    process.env['ATLAS_URL'] = 'https://atlas-dev.forsta.io';
    process.env['ATLAS_UI_URL'] = 'https://app-dev.forsta.io';
    process.env['SIGNAL_URL'] = 'https://forsta-signalserver-dev.herokuapp.com';
    process.env['RESET_CACHE'] = 1;
    process.env['NO_MINIFY'] = 1;
    require('../server/start').main;

    // and go...
    menu.setAppMenu();
    createWindow();
});

    // Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if(process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win == null) {
    createWindow();
    }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.