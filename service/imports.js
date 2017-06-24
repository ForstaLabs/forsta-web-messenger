/*
 * vim: ts=4:sw=4:expandtab
 */

importScripts('/@env.js');
importScripts('/@static/lib/service_deps.js');
importScripts('/@static/lib/textsecure.js');
importScripts('https://www.gstatic.com/firebasejs/4.1.2/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/4.1.2/firebase-messaging.js');


if (forsta_env.SENTRY_DSN) {
    Raven.config(forsta_env.SENTRY_DSN, {
        release: forsta_env.GIT_COMMIT,
        serverName: forsta_env.SERVER_HOSTNAME,
        environment: 'dev'
    }).install();
}


self.localStorage = (function() {
    const data = {};
    return {
        getItem: function(key) {
            return (key in data) ? data[key] : null;
        },

        setItem: function(key, value) {
            data[key] = value;
        },

        removeItem: function(key, value) {
            delete data[key];
        }
    };
})();
