// vim: ts=4:sw=4:expandtab
/* global importScripts */

const cacheBuster = `?v=${F.version}`;

importScripts(`/@env.js` + cacheBuster);

const minifyExt = F.env.NO_MINIFY === '1' ? '' : '.min';

importScripts(`/@static/js/worker/deps${minifyExt}.js` + cacheBuster);
importScripts(`/@static/js/lib/signal${minifyExt}.js` + cacheBuster);
importScripts(`/@static/js/lib/relay${minifyExt}.js` + cacheBuster);
importScripts('https://www.gstatic.com/firebasejs/5.7.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/5.7.0/firebase-messaging.js');
