/*global $, Whisper, Backbone, textsecure, platform*/
/*
 * vim: ts=4:sw=4:expandtab
 */

// This script should only be included in background.html
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};

    /* Inbox window controller */
    var inboxFocused = false;
    var inboxOpened = false;
    window.openInbox = function() {
        console.log('openInbox');
        if (inboxOpened === false) {
            inboxOpened = true;

            setUnreadCount(storage.get("unreadCount", 0));

            addEventListener('blur', function() {
                inboxFocused = false;
            });
            addEventListener('focus', function() {
                inboxFocused = true;
            });
        }
    };

    window.setUnreadCount = function(count) {
        if (count > 0) {
            if (inboxOpened === true) {
                document.title = "Forsta Relay (" + count + ")";
            }
        } else {
            if (inboxOpened === true) {
                document.title = "Forsta Relay";
            }
        }
    };

    var open;
    window.openConversation = function(conversation) {
        if (inboxOpened === true) {
            openConversation(conversation);
        } else {
            open = conversation;
        }
        openInbox();
    };
    window.getOpenConversation = function() {
        var o = open;
        open = null;
        return o;
    };
})();
