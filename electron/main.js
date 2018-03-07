'use strict';

const {app, BrowserWindow, ipcMain} = require('electron');
const menu = require('./menu')
const port = Number(process.env['PORT']) || 10080;

process.on('uncaughtException', function (err) {
    console.error(err);
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;

function createWindow() {
    console.info("Creating Window");
    win = new BrowserWindow({ 
        width: 1024,
        height: 768,
        webPreferences: {
            nodeIntegration: false,
            javascript: true,
            plugins: true,
            preload: __dirname + '/renderer.js',
            experimentalFeatures: true
            // sandbox: true,
            // contextIsolation: true,
        }
    });

    win.loadURL(`http://localhost:${port}/@`);
    // win.webContents.openDevTools()

    // Emitted when the window is closed.
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
    if (!win) {
        createWindow();
    }
});

// In main process.
ipcMain.on('updateUnreadCount', (event, arg) => {
    console.warn("update unread count", arg);
    app.setBadgeCount(arg);
});
