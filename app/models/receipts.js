// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function() {
    'use strict';

    self.F = self.F || {};

    F.ProtocolReceipt = Backbone.Model.extend({
        database: F.Database,
        storeName: 'protocolReceipts'
    });

    F.ProtocolReceiptCollection = Backbone.Collection.extend({
        model: F.ProtocolReceipt,
        database: F.Database,
        storeName: 'protocolReceipts',

        fetchBySent: async function(sent) {
            await this.fetch({
                index: {
                    name: 'sent',
                    only: sent,
                }
            });
        },

        getMessageBySent: async function(sent) {
            const m = new F.Message({sent});
            try {
                await m.fetch();
            } catch(e) {
                if (e.message !== 'Not Found') {
                    throw e;
                }
                return;
            }
            /* Try to return the message instance used by current threads.  Not
             * required but makes any action hence forth update the UI accordingly. */
            return m.getThreadMessage() || m;
        }
    });

    const deliveryQueue = new F.ProtocolReceiptCollection();
    deliveryQueue.type = 'delivery';

    const readQueue = new F.ProtocolReceiptCollection();
    readQueue.type = 'read';

    F.enqueueReadReceipt = async function(attrs) {
        const message = await readQueue.getMessageBySent(attrs.sent);
        if (message) {
            await message.markRead(attrs.read);
        } else {
            attrs.type = readQueue.type;
            await readQueue.add(attrs).save();
        }
    };

    F.enqueueDeliveryReceipt = async function(attrs) {
        const message = await deliveryQueue.getMessageBySent(attrs.sent);
        if (message) {
            await message.addDeliveryReceipt(new F.ProtocolReceipt(attrs));
        } else {
            attrs.type = deliveryQueue.type;
            await deliveryQueue.add(attrs).save();
        }
    };

    F.drainReadReceipts = async function(message) {
        const sent = message.get('sent');
        await readQueue.fetchBySent(sent);
        const receipts = readQueue.where({sent, type: readQueue.type});
        await Promise.all(receipts.map(m => m.destroy()));
        return receipts;
    };

    F.drainDeliveryReceipts = async function(message) {
        const sent = message.get('sent');
        await deliveryQueue.fetchBySent(sent);
        const receipts = deliveryQueue.where({sent, type: deliveryQueue.type});
        await Promise.all(receipts.map(m => m.destroy()));
        return receipts;
    };
})();
