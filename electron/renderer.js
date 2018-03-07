'use strict';

const {ipcRenderer} = require('electron');

self.F = self.F || {};
const ns = self.F.electron = {};

ns.showWindow = function() {
    ipcRenderer.send('showWindow');
};

ns.updateBadge = function(unreadCount) {
    // Send message to main to update badge
    if (isNaN(unreadCount)) {
        ipcRenderer.send('updateUnreadCount', 0);
    } else {
        ipcRenderer.send('updateUnreadCount', unreadCount);
    }
};
