/*global $, Whisper, Backbone, textsecure, extension*/
/*
 * vim: ts=4:sw=4:expandtab
 */

// This script should only be included in background.html
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};

    var conversations = new Whisper.ConversationCollection();
    var inboxCollection = new (Backbone.Collection.extend({
        initialize: function() {
            this.on('change:timestamp change:name change:number', this.sort);
            this.listenTo(conversations, 'add change:active_at', this.addActive);
            this.on('add remove change:unreadCount',
                _.debounce(this.updateUnreadCount.bind(this), 1000)
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

        updateUnreadCount: function() {
            var newUnreadCount = _.reduce(
                this.map(function(m) { return m.get('unreadCount'); }),
                function(item, memo) {
                    return item + memo;
                },
                0
            );
            storage.put("unreadCount", newUnreadCount);
            setUnreadCount(newUnreadCount);
        }
    }))();

    window.getInboxCollection = function() {
        return inboxCollection;
    };

    window.ConversationController = {
        get: function(id) {
            return conversations.get(id);
        },

        add: function(attrs) {
            debugger;
            return conversations.add(attrs, {merge: true});
        },

        create: function(attrs) {
            if (typeof attrs !== 'object') {
                throw new Error('ConversationController.create requires an object, got', attrs);
            }
            var conversation = conversations.add(attrs, {merge: true});
            return conversation;
        },

        findOrCreatePrivateById: async function(id) {
            const conversation = conversations.add({id, type: 'private'});
            try {
                await conversation.fetch();
            } catch(e) {
                debugger; // XXX really?
                const saved = conversation.save(); // false or indexedDBRequest
                if (saved) {
                    await saved;
                } else {
                    throw e;
                }
            }
            return conversation;
        },

        fetchConversations: function() {
            return conversations.fetchActive();
        }
    };
})();
