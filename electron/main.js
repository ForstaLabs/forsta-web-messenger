'use strict';

const {app, BrowserWindow, ipcMain, Tray, Menu} = require('electron');
const menu = require('./menu')
const path = require('path');
const process = require('process');

const port = Number(process.env['PORT']) || 10080;
const icon = path.join(__dirname, '../images/app_icon_192.png');

process.on('uncaughtException', function (err) {
    console.error(err);
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;

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
        darkTheme: true,
        webPreferences: {
            nodeIntegration: false,
            preload: __dirname + '/renderer.js',
            experimentalFeatures: true
            // sandbox: true,
            // contextIsolation: true,
        }
    });

    win.loadURL(`http://localhost:${port}/@`);
    // win.webContents.openDevTools()

    win.on('close', ev => {
        ev.preventDefault();
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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
    console.info("Starting server");
    require('../server/start');
    menu.setAppMenu();
    const tray = new Tray(icon);
    tray.setToolTip('Forsta Secure Messenger');
    tray.on('click', showWindow);
    createWindow();
});

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if(process.platform !== 'darwin') {
        //app.quit();
    }
});

app.on('activate', showWindow);

// In main process.
ipcMain.on('updateUnreadCount', (event, arg) => {
    console.warn("update unread count", arg);
    app.setBadgeCount(arg);
});
