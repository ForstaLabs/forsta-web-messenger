'use strict';

const {ipcRenderer} = require('electron');

self.F = self.F || {};

var electron = {
    updateBadge: function (unreadCount) {
        // Send message to main to update badge
        if (isNaN(unreadCount)) {
            ipcRenderer.send('updateUnreadCount', 0);
        } else {
            ipcRenderer.send('updateUnreadCount', unreadCount);
        }
    }
};

self.F.electron = electron;