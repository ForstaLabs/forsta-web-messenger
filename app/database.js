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
                const threads = t.objectStore('threads');
                threads.createIndex('timestamp', ['timestamp']);
                next();
            }
        }, {
            version: 3,
            migrate: function(t, next) {
                const cacheStore = t.db.createObjectStore('cache');
                cacheStore.createIndex('bucket-expiration', ['bucket', 'expiration']);
                next();
            }
        }, {
            version: 4,
            migrate: function(t, next) {
                next();
            }
        }, {
            version: 5,
            migrate: function(t, next) {
                next();
            }
        }, {
            version: 6,
            migrate: function(t, next) {
                t.db.createObjectStore('contacts');
                next();
            }
        }, {
            version: 7,
            migrate: function(t, next) {
                const messages = t.objectStore('messages');
                messages.createIndex('member', 'members', {multiEntry: true});
                next();
            }
        }, {
            version: 8,
            migrate: function(t, next) {
                const threads = t.objectStore('threads');
                threads.createIndex('pendingMember', 'pendingMembers', {multiEntry: true});
                next();
            }
        }, {
            version: 9,
            migrate: function(t, next) {
                next();
            }
        }, {
            version: 10,
            migrate: function(t, next) {
                const messages = t.objectStore('messages');
                messages.createIndex('ngrams3', 'ngrams3', {multiEntry: true});
                next();
            }
        }, {
            version: 11,
            migrate: function(t, next) {
                const store = t.db.createObjectStore('protocolReceipts');
                store.createIndex('sent', 'sent');
                next();
            }
        }, {
            version: 12,
            migrate: function(t, next) {
                next();
            }
        }, {
            version: 13,
            migrate: function(t, next) {
                next();
            }
        }, {
            version: 14,
            migrate: function(t, next) {
                const threads = t.objectStore('threads');
                threads.createIndex('archived-timestamp', ['archived', 'timestamp']);
                threads.deleteIndex('type-timestamp');
                threads.openCursor().onsuccess = ev => {
                    const cursor = ev.target.result;
                    if (cursor) {
                        if (cursor.value.archived === undefined) {
                            cursor.update(Object.assign(cursor.value, {archived: 0}));
                        }
                        cursor.continue();
                    } else {
                        next();
                    }
                };
            }
        }, {
            version: 15,
            migrate: function(t, next) {
                const messages = t.objectStore('messages');
                messages.deleteIndex('ngrams3');
                messages.createIndex('from-ngrams', '_from_ngrams', {multiEntry: true});
                messages.createIndex('to-ngrams', '_to_ngrams', {multiEntry: true});
                messages.createIndex('body-ngrams', '_body_ngrams', {multiEntry: true});
                setTimeout(updateMessageSearchIndex, 1000); // Must run outside this context.
                next();
            }
        }]
    };

    F.SharedCacheDatabase = {
        nolog: true,
        id: `${name}-shared-cache`,

        migrations: [{
            version: 1,
            migrate: function(t, next) {
                const cacheStore = t.db.createObjectStore('cache');
                cacheStore.createIndex('bucket-expiration', ['bucket', 'expiration']);
            }
        }]
    };

    async function updateMessageSearchIndex() {
        console.warn("Starting message search index update...");
        const messages = new F.MessageCollection();
        await messages.fetch();
        let i = 0;
        for (const message of messages.models) {
            if (++i % 100 === 0) {
                console.log(`Updated search index for ${i++} messsages`);
            }
            try {
                await message.save();
            } catch(e) {
                console.error("Error saving message:", e);
            }
        }
        console.warn("Done updating message search index.");
    }

    F.updateMessageSearchIndex = updateMessageSearchIndex;
}());
