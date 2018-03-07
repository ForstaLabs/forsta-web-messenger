'use strict';

const {app, BrowserWindow, ipcMain, Tray, nativeImage} = require('electron');
const menu = require('./menu');
const path = require('path');
const process = require('process');

const title = 'Forsta Messenger';
const port = Number(process.env['PORT']) || 10080;
const imagesDir = path.join(__dirname, '../images/');
const icon = nativeImage.createFromPath(imagesDir + 'favicon.png');
const iconPending = nativeImage.createFromPath(imagesDir + 'favicon-pending.png');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;
let tray;

function showWindow() {
    if (!win) {
        createWindow();
    } else {
        win.show();
    }
}

function createWindow() {
    console.info("Creating Window");
    win = new BrowserWindow({ 
        width: 1024,
        height: 768,
        icon,
        title,
        darkTheme: true,
        webPreferences: {
            nodeIntegration: false,
            preload: path.join(__dirname, 'renderer.js'),
            experimentalFeatures: true
            // sandbox: true,
            // contextIsolation: true,
        }
    });

    win.loadURL(`http://localhost:${port}/@`);
    // win.webContents.openDevTools()

    win.on('close', ev => {
        ev.preventDefault();
        console.warn("Translating window close into hide.");
        win.hide();  // Keep it alive to avoid closing our websocket.
    });
    win.on('closed', () => {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        console.warn("Window closed");
        win = null;
    });
}


app.on('ready', () => {
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    console.info("Starting server");
    require('../server/start');
    menu.setAppMenu();
    tray = new Tray(icon);
    tray.setToolTip(title);
    tray.on('click', showWindow);
    createWindow();
});
app.on('before-quit', () => {
    console.error("Shutdown: Destroying window");
    win.destroy();
    win = null;
});
app.on('activate', showWindow);


// Handle events sent from the browser...
ipcMain.on('updateUnreadCount', (event, count) => {
    app.setBadgeCount(count);
    tray.setImage(count ? iconPending : icon);
    tray.setToolTip(count ? `${count} unread messages` : title);
});
ipcMain.on('showWindow', () => showWindow());
