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
                receipts.createIndex('messageId', 'messageId');
                const threads = t.db.createObjectStore('threads');
                threads.createIndex('type-timestamp', ['type', 'timestamp']);
                t.db.createObjectStore('sessions');
                t.db.createObjectStore('identityKeys');
                t.db.createObjectStore('preKeys');
                t.db.createObjectStore('signedPreKeys');
                t.db.createObjectStore('state');
                next();
            }
        }, {
            version: 2,
            migrate: function(t, next) {
                console.warn('Migration 2: Creating thread timestamp index');
                const threads = t.objectStore('threads');
                threads.createIndex('timestamp', ['timestamp']);
                next();
            }
        }, {
            version: 3,
            migrate: function(t, next) {
                console.warn('Migration 3: Create cache store');
                const cacheStore = t.db.createObjectStore('cache');
                cacheStore.createIndex('bucket-expiration', ['bucket', 'expiration']);
                next();
            }
        }, {
            version: 4,
            migrate: function(t, next) {
                console.warn('Migration 4: Noop');
                next();
            }
        }, {
            version: 5,
            migrate: function(t, next) {
                console.warn('Migration 5: Noop');
                next();
            }
        }, {
            version: 6,
            migrate: function(t, next) {
                console.warn('Migration 6: Add contacts store');
                t.db.createObjectStore('contacts');
                next();
            }
        }, {
            version: 7,
            migrate: function(t, next) {
                console.warn('Migration 7: Add members index for messages');
                const messages = t.objectStore('messages');
                messages.createIndex('member', 'members', {multiEntry: true});
                next();
            }
        }, {
            version: 8,
            migrate: function(t, next) {
                console.warn('Migration 8: Add pendingMembers index for threads');
                const messages = t.objectStore('threads');
                messages.createIndex('pendingMember', 'pendingMembers', {multiEntry: true});
                next();
            }
        }, {
            version: 9,
            migrate: function(t, next) {
                console.warn('Migration 9: Noop');
                next();
            }
        }, {
            version: 10,
            migrate: function(t, next) {
                const messages = t.objectStore('messages');
                messages.createIndex('ngrams3', 'ngrams3', {multiEntry: true});
                next();
            }
        }]
    };
}());
