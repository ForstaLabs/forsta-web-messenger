/*
 * vim: ts=4:sw=4:expandtab
 */

(function () {
    'use strict';

    self.F = self.F || {};

    const name = `${F.product}-2`; // With a salt value incase we want to force a reset.

    F.Database = {
        nolog: true,

        setId: function(id) {
            F.Database.id = `${name}-${id}`;
        },

        migrations: [{
            version: 1,
            migrate: function(t, next) {
                console.warn('Migration 1: Creating initial stores');
                const messages = t.db.createObjectStore('messages');
                messages.createIndex('threadId-received', ['threadId', 'received']);
                messages.createIndex('threadId-read', ['threadId', 'read']);
                messages.createIndex('sent', 'sent');
                messages.createIndex('expire', 'expire');

                const receipts = t.db.createObjectStore('receipts');
                receipts.createIndex('messageId', 'messageId', {unique: false});

                const threads = t.db.createObjectStore('threads');
                threads.createIndex('type-timestamp', ['type', 'timestamp']);

                t.db.createObjectStore('sessions');
                t.db.createObjectStore('identityKeys');
                t.db.createObjectStore('preKeys');
                t.db.createObjectStore('signedPreKeys');
                t.db.createObjectStore('state');

                next();
            }
        }]
    };
}());
