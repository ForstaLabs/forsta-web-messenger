// vim: ts=4:sw=4:expandtab
/* global importScripts */

const m = location.search.match(/[?&]v=([^&]*)/);
const version = m ? m[1] : Date.now().toString();
const cacheToken = '?v=' + version;
importScripts('/@env.js' + cacheToken);
importScripts('/@static/js/worker/deps.js' + cacheToken);
importScripts('/@static/js/lib/signal.js' + cacheToken);
importScripts('/@static/js/lib/relay.js' + cacheToken);
importScripts('https://www.gstatic.com/firebasejs/4.5.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/4.5.0/firebase-messaging.js');
