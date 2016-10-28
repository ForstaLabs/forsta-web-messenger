/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.platform = window.platform || {};

    /*
    window.platform.navigator = (function () {
        var self = {},
            tabs = {};
        tabs.create = function (url) {
            if (chrome.tabs) {
                chrome.tabs.create({url: url});
            } else {
                window.platform.windows.open({url: url});
            }
        };
        self.tabs = tabs;

        return self;
    }());
    */

    /*
    window.platform.trigger = function (name, object) {
        chrome.runtime.sendMessage(null, { name: name, data: object });
    };
    */

    /*
    window.platform.on = function (name, callback) {
        // this causes every listener to fire on every message.
        // if we eventually end up with lots of listeners (lol)
        // might be worth making a map of 'name' -> [callbacks, ...]
        // so we can fire a single listener that calls only the necessary
        // calllbacks for that message name
        chrome.runtime.onMessage.addListener(function(e) {
            if (e.name === name) {
                callback(e.data);
            }
        });
    };
    */

    platform.windows = {
        /*
        open: function(options, callback) {
            if (chrome.windows) {
                chrome.windows.create(options, callback);
            } else if (chrome.app.window) {
                var url = options.url;
                delete options.url;
                chrome.app.window.create(url, options, callback);
            }
        },

        focus: function(callback) {
            if (chrome.windows) {
                chrome.windows.update(id, { focused: true }, function() {
                    callback(chrome.runtime.lastError);
                });
            } else if (chrome.app.window) {
                var appWindow = chrome.app.window.get(id);
                if (appWindow) {
                    appWindow.show();
                    appWindow.focus();
                    callback();
                } else {
                    callback('No window found for id ' + id);
                }
            }
        },

        getCurrent: function(callback) {
            if (chrome.windows) {
                chrome.windows.getCurrent(callback);
            } else if (chrome.app.window) {
                callback(chrome.app.window.current());
            }
        },

        remove: function(windowId) {
            if (chrome.windows) {
                chrome.windows.remove(windowId);
            } else if (chrome.app.window) {
                chrome.app.window.get(windowId).close();
            }
        },

        getBackground: function(callback) {
            var getBackground;
            if (chrome.extension) {
                var bg = chrome.extension.getBackgroundPage();
                bg.storage.onready(function() {
                    callback(bg);
                    resolve();
                });
            } else if (chrome.runtime) {
                chrome.runtime.getBackgroundPage(function(bg) {
                    bg.storage.onready(function() {
                        callback(bg);
                    });
                });
            }
        },

        getAll: function() {
            return chrome.app.window.getAll();
        },

        getViews: function() {
            if (chrome.extension) {
                return chrome.extension.getViews();
            } else if (chrome.app.window) {
                return chrome.app.window.getAll().map(function(appWindow) {
                    return appWindow.contentWindow;
                });
            }
        },

        onSuspend: function(callback) {
            if (chrome.runtime) {
                chrome.runtime.onSuspend.addListener(callback);
            } else {
                window.addEventListener('beforeunload', callback);
            }
        },
        */
        onClosed: function(callback) {
            window.addEventListener('beforeunload', callback);
        }
    };

    /*
    window.platform.onLaunched = function(callback) {
        if (chrome.browserAction && chrome.browserAction.onClicked) {
            chrome.browserAction.onClicked.addListener(callback);
        }
        if (chrome.app && chrome.app.runtime) {
            chrome.app.runtime.onLaunched.addListener(callback);
        }
    };
    */

    // Translate
    window.i18n = function(message, substitutions) {
        console.warn("TRANSLATION IS BROKEN", message);
        if (substitutions !== undefined) {
            debugger; // Get into it.
        }
        return 'TRANSLATION_BROKEN(' + message + ')';
    };

    i18n.getLocale = function() {
        return navigator.language.split('-')[0];
    };

    /*
    platform.install = function(mode) {
        var id = 'installer';
        var url = 'options.html';
        if (mode === 'standalone') {
            id = 'standalone-installer';
            url = 'register.html';
        }
        if (!chrome.app.window.get(id)) {
            platform.windows.open({
                id: id,
                url: url,
                bounds: { width: 800, height: 666, },
                minWidth: 800,
                minHeight: 666
            });
        }
    };
    */

    var notification_pending = Promise.resolve();
    platform.notification = {
        init: function() {
            console.warn("Not Implemented");
            return;
            // register some chrome listeners
            if (chrome.notifications) {
                chrome.notifications.onClicked.addListener(function() {
                    platform.notification.clear();
                    Whisper.Notifications.onclick();
                });
                chrome.notifications.onButtonClicked.addListener(function() {
                    platform.notification.clear();
                    Whisper.Notifications.clear();
                    getInboxCollection().each(function(model) {
                        model.markRead();
                    });
                });
                chrome.notifications.onClosed.addListener(function(id, byUser) {
                    if (byUser) {
                        Whisper.Notifications.clear();
                    }
                });
            }
        },
        clear: function() {
            notification_pending = notification_pending.then(function() {
                return new Promise(function(resolve) {
                    console.warn("Not Implemented");
                    //chrome.notifications.clear('relay',  resolve);
                });
            });
        },
        update: function(options) {
            console.warn("Not Implemented");
            return
            if (chrome) {
                var chromeOpts = {
                    type     : options.type,
                    title    : options.title,
                    message  : options.message || '', // required
                    iconUrl  : options.iconUrl,
                    imageUrl : options.imageUrl,
                    items    : options.items,
                    buttons  : options.buttons
                };
                notification_pending = notification_pending.then(function() {
                    return new Promise(function(resolve) {
                        chrome.notifications.update('relay', chromeOpts, function(wasUpdated) {
                            if (!wasUpdated) {
                                chrome.notifications.create('relay', chromeOpts, resolve);
                            } else {
                                resolve();
                            }
                        });
                    });
                });
            } else {
                var notification = new Notification(options.title, {
                    body : options.message,
                    icon : options.iconUrl,
                    tag  : 'relay'
                });
                notification.onclick = function() {
                    Whisper.Notifications.onclick();
                };
            }
        }
    };

    /*
    platform.keepAwake = function() {
        if (chrome && chrome.alarms) {
            chrome.alarms.onAlarm.addListener(function() {
                // nothing to do.
            });
            chrome.alarms.create('awake', {periodInMinutes: 1});
        }
    };
    */

    /*
    if (chrome.runtime.onInstalled) {
        chrome.runtime.onInstalled.addListener(function(options) {
            if (options.reason === 'install') {
                platform.install();
            }
        });
    }
    */
}());
