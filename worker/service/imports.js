// vim: ts=4:sw=4:expandtab
/* global importScripts */

// Must break cache of env.js to get correct GIT_COMMIT.
importScripts('/@env.js?v=' + Date.now().toString());

const cacheToken = '?v=' + F.env.GIT_COMMIT.substring(0, 8);
const minify_ext = F.env.NO_MINIFY === '1' ? '' : '.min';
importScripts(`/@static/js/worker/deps${minify_ext}.js` + cacheToken);
importScripts(`/@static/js/lib/signal${minify_ext}.js` + cacheToken);
importScripts(`/@static/js/lib/relay${minify_ext}.js` + cacheToken);
importScripts('https://www.gstatic.com/firebasejs/4.6.2/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/4.6.2/firebase-messaging.js');
