'use strict';

const { app,
        BrowserWindow,
        ipcMain,
        Tray,
        nativeImage,
        shell
    } = require('electron');
const menu = require('./menu');
const path = require('path');
const process = require('process');
const platform = require('os').platform();

const title = 'Forsta Messenger';
const port = Number(process.env['PORT']) || 10080;
const imagesDir = path.join(__dirname, '../dist/static/images/');
const appIcon = nativeImage.createFromPath(imagesDir + 'app.png');

let trayIcon;
let trayIconPending;
if (platform === 'darwin') {
    trayIcon = nativeImage.createFromPath(imagesDir + 'macTrayIcon.png');
    trayIcon.setTemplateImage(true);
    trayIconPending = nativeImage.createFromPath(imagesDir + 'macTrayIconPending.png');
    trayIconPending.setTemplateImage(true);
} else {
    trayIcon = nativeImage.createFromPath(imagesDir + 'favicon.png');
    trayIconPending = nativeImage.createFromPath(imagesDir + 'favicon-pending.png');
}

// Contextual menus
require('electron-context-menu')({
	// prepend: (params, browserWindow) => [{
	// 	label: 'Rainbow',
	// 	// Only show it when right-clicking images
	// 	visible: params.mediaType === 'image'
	// }]
});

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;
let tray;

if (app.dock) {
    app.dock.setIcon(appIcon);
}

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
        icon: appIcon,
        title,
        webPreferences: {
            nodeIntegration: false,
            sandbox: true,
            preload: path.join(__dirname, 'renderer.js')
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

    // Open clicked links in external browser
    // source: https://stackoverflow.com/questions/32402327/how-can-i-force-external-links-from-browser-window-to-open-in-a-default-browser
    win.webContents.on('new-window', function(e, url) {
        e.preventDefault();
        shell.openExternal(url);
    });
}


app.on('ready', () => {
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    process.env.PORT = port;
    require('../server/start');

    menu.setAppMenu();

    tray = new Tray(trayIcon);
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
    tray.setImage(count ? trayIconPending : trayIcon);
    tray.setToolTip(count ? `${count} unread messages` : title);
});

ipcMain.on('showWindow', () => showWindow());

ipcMain.on('openExternalURL', (event, url) => {
    shell.openExternal(url);
});
