/*
 * vim: ts=4:sw=4:expandtab
 */
;(function() {
    'use strict';

    window.F = window.F || {};

    var SETTINGS = {
        OFF     : 'off',
        COUNT   : 'count',
        NAME    : 'name',
        MESSAGE : 'message'
    };

    F.Notifications = new (Backbone.Collection.extend({
        initialize: function() {
            this.on('add', this.onAdd);
            this.on('remove', this.onRemove);
            this.notes = {};
        },

        havePermission: function() {
            return window.Notification && Notification.permission === 'granted';
        },

        onAdd: function(message, collection, options) {
            const setting = storage.get('notification-setting') || 'message';
            if (setting === SETTINGS.OFF || !this.havePermission()) {
                console.warn("Notification muted:", message);
                return;
            }

            let title;
            const note = {
                icon: F.urls.static + 'images/icon_128.png',
                tag: 'forsta'
            };

            if (setting === SETTINGS.COUNT) {
                title = [
                    this.length,
                    this.length === 1 ? i18n('newMessage') : i18n('newMessages')
                ].join(' ');
            } else {
                title = message.get('title');
                note.tag = message.get('conversationId');
                note.icon = message.get('iconUrl');
                note.image = message.get('imageUrl') || undefined;
                if (setting === SETTINGS.NAME) {
                    note.body = i18n('newMessage');
                } else if (setting === SETTINGS.MESSAGE) {
                    note.body = message.get('message');
                } else {
                    throw new Error("Invalid setting");
                }
            }
            note.requireInteraction = false;
            note.renotify = true;
            const n = new Notification(title, note);
            n.addEventListener('click', function() {
                parent.focus();
                n.close();
                const last = this.last();
                if (!last) {
                    console.warn("Message no longer available to show");
                } else {
                    F.mainView.openConversationById(last.get('conversationId'));
                    this.reset([]);
                }
            }.bind(this));
            this.notes[message.get('cid')] = n;
        },

        onRemove: function(message, collection, options) {
            const note = this.notes[message.get('cid')];
            if (note) {
                delete this.notes[message.get('cid')];
                note.close();
            }
        }
    }))();
})();
