/*
 * vim: ts=4:sw=4:expandtab
 *
 * See: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
 * TL;DR; This gets downloaded every 24 hours.
 */

importScripts('../env.js');
importScripts('https://www.gstatic.com/firebasejs/4.1.2/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/4.1.2/firebase-messaging.js');

firebase.initializeApp(forsta_env.FIREBASE_CONFIG);
const fbm = firebase.messaging();

fbm.setBackgroundMessageHandler(function(payload) {
    console.info('Received background message!', payload);
    /* XXX TBD. */
    const notificationTitle = 'Message waiting from' + payload.from;
    const notificationOptions = {
        body: 'Well, it\'s a alive, not do something with it:' + JSON.stringify(payload)
    };
    return self.registration.showNotification(notificationTitle, notificationOptions);
});
