'use strict';

const {ipcRenderer} = require('electron');

self.F = self.F || {};
const ns = self.F.electron = {
    isElectron: true
};

// Open all links in external browser
let shell = require('electron').shell;
document.addEventListener('click', function (event) {
  if (event.target.tagName === 'A' && event.target.href.startsWith('http')) {
    event.preventDefault();
    ipcRenderer.send('openExternalURL', event.target.href);
  }
});

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
