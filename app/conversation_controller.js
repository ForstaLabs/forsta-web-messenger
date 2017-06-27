/*global $, Whisper, Backbone, textsecure, extension*/
/*
 * vim: ts=4:sw=4:expandtab
 */

// This script should only be included in background.html
(function () {
    'use strict';

    self.F = self.F || {};

    const conversations = new F.ConversationCollection();

    const inboxCollection = new (Backbone.Collection.extend({
        initialize: function() {
            this.on('change:timestamp change:name change:number', this.sort);
            this.listenTo(conversations, 'add change:active_at', this.addActive);
            this.on('add remove change:unreadCount',
                _.debounce(this.updateUnreadCount.bind(this), 100)
            );
        },

        comparator: function(m1, m2) {
            var timestamp1 = m1.get('timestamp');
            var timestamp2 = m2.get('timestamp');
            if (timestamp1 && timestamp2) {
                return timestamp2 - timestamp1;
            }
            if (timestamp1) {
                return -1;
            }
            if (timestamp2) {
                return 1;
            }
            var title1 = m1.getTitle().toLowerCase();
            var title2 = m2.getTitle().toLowerCase();
            if (title1 ===  title2) {
                return 0;
            }
            if (title1 < title2) {
                return -1;
            }
            if (title1 > title2) {
                return 1;
            }
        },

        addActive: function(model) {
            if (model.get('active_at')) {
                this.add(model);
            } else {
                this.remove(model);
            }
        },

        updateUnreadCount: async function() {
            var newUnreadCount = _.reduce(
                this.map(function(m) { return m.get('unreadCount'); }),
                function(item, memo) {
                    return item + memo;
                },
                0
            );
            F.router && F.router.setTitleUnread(newUnreadCount);
            await F.state.put("unreadCount", newUnreadCount);
        }
    }))();

    F.getInboxCollection = function() {
        return inboxCollection;
    };

    F.getConversations = function() {
        return conversations;
    };

    F.ConversationController = {
        get: function(id) {
            console.warn("DEPRECATED");
            throw new Error("DEPRECATED");
            return conversations.get(id);
        },

        add: function(attrs) {
            console.warn("DEPRECATED");
            throw new Error("DEPRECATED");
            return conversations.add(attrs, {merge: true});
        },

        create: function(attrs) {
            console.warn("DEPRECATED");
            throw new Error("DEPRECATED");
            if (typeof attrs !== 'object') {
                throw new Error('ConversationController.create requires an object, got', attrs);
            }
            var conversation = conversations.add(attrs, {merge: true});
            return conversation;
        },

        findOrCreatePrivateById: function(id) {
            console.warn("DEPRECATED");
            throw new Error("DEPRECATED");
            var conversation = conversations.add({ id: id, type: 'private' });
            return new Promise(function(resolve, reject) {
                conversation.fetch().then(function() {
                    resolve(conversation);
                }).catch(function() {
                    var saved = conversation.save(); // false or indexedDBRequest
                    if (saved) {
                        saved.then(function() {
                            resolve(conversation);
                        }).catch(reject);
                    } else {
                        reject();
                    }
                });
            });
        },

        fetchConversations: function() {
            console.warn("DEPRECATED");
            throw new Error("DEPRECATED");
            return conversations.fetchActive();
        }
    };
})();
