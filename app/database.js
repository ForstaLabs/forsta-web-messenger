/*
 * vim: ts=4:sw=4:expandtab
 */

(function () {
    'use strict';

    self.F = self.F || {};

    F.Database = {
        id: 'Forsta-v2',
        nolog: true,
        migrations: [{
            version: 1,
            migrate: function(t, next) {
                console.log('migration 1.0: creating object stores');
                const messages = t.db.createObjectStore("messages");
                messages.createIndex("conversation", ["conversationId", "received_at"],
                                     {unique: false});
                messages.createIndex("receipt", "sent_at", {unique: false});
                messages.createIndex('unread', ['conversationId', 'unread'], {unique: false});
                messages.createIndex('expire', 'expireTimer', {unique: false});

                const conversations = t.db.createObjectStore("conversations");
                conversations.createIndex("inbox", "active_at", {unique: false});
                conversations.createIndex("group", "members", {unique: false, multiEntry: true});
                conversations.createIndex("type", "type", {unique: false});
                conversations.createIndex("search", "tokens", {unique: false, multiEntry: true});

                t.db.createObjectStore('groups');
                t.db.createObjectStore('sessions');
                t.db.createObjectStore('identityKeys');
                t.db.createObjectStore("preKeys");
                t.db.createObjectStore("signedPreKeys");

                next();
            }
        }]
    };
}());
