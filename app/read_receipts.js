// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    self.F = self.F || {};

    F.ReadReceipts = new (Backbone.Collection.extend({
        initialize: function() {
            this.on('add', this.onReceipt);
        },

        forMessage: function(message) {
            var receipt = this.findWhere({
                sender: message.get('source'),
                timestamp: message.get('sent_at')
            });
            if (receipt) {
                console.log('Found early read receipt for message');
                this.remove(receipt);
                return receipt;
            }
        },

        onReceipt: async function(receipt) {
            var messages  = new F.MessageCollection();
            await messages.fetchSentAt(receipt.get('timestamp'));
            var message = messages.find(function(message) {
                return (message.isIncoming() && message.isUnread() &&
                        message.get('source') === receipt.get('sender'));
            });
            if (message) {
                this.remove(receipt);
                await message.markRead(receipt.get('read_at'));
                const convo = await message.getConversation();
                if (convo) {
                    convo.trigger('read', message);
                }
            } else {
                console.warn('No message for read receipt');
            }
        }
    }))();
})();
