/*
 * vim: ts=4:sw=4:expandtab
 */
;(function() {
    'use strict';
    window.Whisper = window.Whisper || {};

    var SETTINGS = {
        OFF     : 'off',
        COUNT   : 'count',
        NAME    : 'name',
        MESSAGE : 'message'
    };

    Whisper.Notifications = new (Backbone.Collection.extend({
        initialize: function() {
            this.on('add', this.onAdd);
            this.on('remove', this.onRemove);
            this.notes = {};
        },
        onAdd: function(model, collection, options) {
            const setting = storage.get('notification-setting') || 'message';
            if (setting === SETTINGS.OFF || Notification.permission !== 'granted') {
                console.warn("Notification muted:", model);
                return;
            }
            console.info("Adding Notification: ", model);

            let title;
            const note = {
                icon: 'images/icon_128.png',
                tag: 'relay'
            };

            if (setting === SETTINGS.COUNT) {
                title = [
                    this.length,
                    this.length === 1 ? i18n('newMessage') : i18n('newMessages')
                ].join(' ');
            } else {
                title = model.get('title');
                note.tag = model.get('conversationId');
                note.icon = model.get('iconUrl');
                note.image = model.get('imageUrl') || undefined;
                if (setting === SETTINGS.NAME) {
                    note.body = i18n('newMessage');
                } else if (setting === SETTINGS.MESSAGE) {
                    note.body = model.get('message');
                } else {
                    throw new Error("Invalid setting");
                }
            }
            note.requireInteraction = true;
            note.renotify = true;
            const n = new Notification(title, note);
            n.addEventListener('click', function() {
                parent.focus();
                n.close();
                const last = this.last();
                if (!last) {
                    openInbox();
                } else {
                    var conversation = ConversationController.create({
                        id: last.get('conversationId')
                    });
                    openConversation(conversation);
                    this.reset([]);
                }
            }.bind(this));
            this.notes[model.get('cid')] = n;
        },
        onRemove: function(model, collection, options) {
            console.info("Removing Notification: ", model);
            const note = this.notes[model.get('cid')];
            if (note) {
                delete this.notes[model.get('cid')];
                note.close();
            }
        }
    }))();
})();
