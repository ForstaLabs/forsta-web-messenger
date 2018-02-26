// vim: ts=4:sw=4:expandtab
/* global relay */

/*
 * Sync engine that handles comparing our data with our other devices so we can
 * stay in sync.  Mostly for onboarding new devices.
 */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.sync = {};

    class Request extends F.AsyncEventTarget {

        constructor() {
            super();
            this.syncThread = new F.Thread({}, {deferSetup: true});
            this.id = this.syncThread.id;
            this.updateCounts = {
                messages: 0,
                threads: 0,
                contacts: 0
            };
            this._messageCollections = new Map();
            addEventListener('syncResponse', ev => {
                if (ev.id !== this.id) {
                    console.warn("Dropping sync response from foreign session:", ev.id);
                    return;
                }
                F.queueAsync('sync:' + this.id, () =>
                    this.onResponse(ev.data.exchange, ev.data.attachments));
            });
        }

        async start(limit) {
            if (this._started) {
                throw new TypeError("Sync request already started");
            }
            this._started = true;
            const tooOld = Date.now() - (86400 * 7 * 1000);
            let devices = await F.atlas.getDevices();
            devices = devices.filter(x => x.id !== F.currentDevice && x.lastSeen > tooOld);
            if (!devices.length) {
                console.warn("No devices to sync with!");
                return;
            }
            devices.sort((a, b) => b.created - a.created);
            devices = devices.slice(0, limit);
            console.info("Starting sync request with:", devices.map(x => x.id));
            const known = await this.catalogKnown();
            await this.syncThread.sendSyncControl(Object.assign({
                control: 'syncRequest',
                devices: devices.map(x => x.id)
            }, known));
        }

        async catalogKnown() {
            /* Collect all of our own data so we can filter out content we already
             * posses. */
            const knownMessages = [];
            const knownThreads = [];
            const knownContacts = F.foundation.getContacts().map(x => x.id);
            for (const thread of F.foundation.allThreads.models) {
                const mc = new F.MessageCollection([], {thread});
                await mc.fetchAll();
                for (const m of mc.models) {
                    knownMessages.push(m.id);
                }
                knownThreads.push({
                    id: thread.id,
                    lastActivity: new Date(thread.get('timestamp'))
                });
            }
            return {
                knownMessages,
                knownThreads,
                knownContacts
            };
        }

        async onResponse(exchange, allAttachments) {
            const candidates = {
                threads: exchange.data.threads || [],
                messages: exchange.data.messages || [],
                contacts: exchange.data.contacts || []
            };
            console.info(`Handling sync response candidates: ` +
                         `${candidates.threads.length} threads, ` +
                         `${candidates.messages.length} messages, ` +
                         `${candidates.contacts.length} contacts.`);
            let shouldEvent = false;
            for (const t of candidates.threads) {
                const existing = F.foundation.allThreads.get(t.id);
                if (!existing || existing.get('timestamp') < t.timestamp) {
                    await F.foundation.allThreads.add(t).save();
                    this.updateCounts.threads++;
                    shouldEvent = true;
                }
            }

            for (const m of candidates.messages) {
                if (!this._messageCollections.has(m.threadId)) {
                    const mc = new F.MessageCollection([], {threadId: m.threadId});
                    await mc.fetchAll();
                    this._messageCollections.set(m.threadId, mc);
                }
                const mCol = this._messageCollections.get(m.threadId);
                if (!mCol.get(m.id)) {
                    if (m.attachments.length) {
                        for (const x of m.attachments) {
                            x.data = allAttachments[x.index].data;
                            delete x.index;
                        }
                    }
                    await mCol.add(m).save();
                    this.updateCounts.messages++;
                    shouldEvent = true;
                }
            }

            const ourContacts = F.foundation.getContacts();
            const newContacts = [];
            for (const c of candidates.contacts) {
                if (!ourContacts.get(c)) {
                    newContacts.push(c);
                }
            }
            shouldEvent = shouldEvent || !!newContacts.length;
            await F.atlas.getContacts(newContacts);
            this.updateCounts.contacts += newContacts.length;

            if (shouldEvent) {
                const ev = new Event('updates');
                ev.request = this;
                ev.updateCounts = this.updateCounts;
                await this.dispatchEvent(ev);
            }
        }
    }
    ns.Request = Request;

    async function sendMessages(senderThread, device, messages) {
        console.info(`Synchronizing ${messages.length} messages with device:`, device);
        const allAttachments = [];
        await senderThread.sendSyncControl({
            control: 'syncResponse',
            device,
            messages: messages.map(model => {
                const m = model.attributes;
                const attachments = [];
                if (m.attachments) {
                    for (const x of m.attachments) {
                        const index = allAttachments.push(x) - 1;
                        const proxy = Object.assign({index}, x);
                        delete proxy.data;
                        attachments.push(proxy);
                    }
                }
                return {
                    attachments,
                    expiration: m.expiration,
                    html: m.safe_html,
                    id: m.id,
                    members: m.members,
                    monitors: m.monitors,
                    pendingMembers: m.pendingMembers,
                    plain: m.plain,
                    received: m.received,
                    sender: m.sender,
                    senderDevice: m.senderDevice,
                    sent: m.sent,
                    threadId: m.threadId,
                    type: m.type,
                    userAgent: m.userAgent,
                };
            })
        }, allAttachments);
    }

    async function sendThreads(senderThread, device, threads) {
        console.info(`Synchronizing ${threads.length} threads with device:`, device);
        await senderThread.sendSyncControl({
            control: 'syncResponse',
            device,
            threads: threads.map(thread => {
                const t = thread.attributes;
                return {
                    distribution: t.distribution,
                    id: t.id,
                    lastMessage: t.lastMessage,
                    left: t.left,
                    pendingMembers: t.pendingMembers,
                    pinned: t.pinned,
                    position: t.postion,
                    sender: t.sender,
                    started: t.started,
                    timestamp: t.timestamp,
                    type: t.type,
                    unreadCount: t.unreadCount,
                };
            })
        });
    }

    async function sendContacts(senderThread, device, contacts) {
        console.info(`Synchronizing ${contacts.length} contacts with device:`, device);
        await senderThread.sendSyncControl({
            control: 'syncResponse',
            device,
            contacts: contacts.map(contact => contact.id)
        });
    }
 
    ns.processRequest = async function(ev) {
        console.info("Handling sync request:", ev.id);
        const exchange = ev.data.exchange;
        const senderDevice = ev.data.message.get('senderDevice');
        const senderThread = new F.Thread({id: exchange.threadId}, {deferSetup: true});

        const theirContacts = new Set(exchange.data.knownContacts);
        const theirThreads = new Map(exchange.data.knownThreads.map(x => [x.id, x.lastActivity]));
        const theirMessages = new Set(exchange.data.knownMessages);

        /* Monitor the activity of other responders while we wait our turn.
         * We can mark off data sent by our peers to avoid duplication. */
        const onPeerResponse = respEvent => {
            if (respEvent.id !== ev.id) {
                console.warn("Dropping sync response from foreign session:", ev.id);
                return;
            }
            const peerData = respEvent.data.exchange.data;
            for (const t of (peerData.threads || [])) {
                theirThreads.set(t.id, (new Date(t.timestamp)).toJSON());
            }
            for (const m of (peerData.messages || [])) {
                theirMessages.add(m.id);
            }
            for (const c of (peerData.contacts || [])) {
                theirContacts.add(c);
            }
        };

        addEventListener('syncResponse', onPeerResponse);
        try {
            const ourTurn = exchange.data.devices.indexOf(F.currentDevice); 
            await relay.util.sleep(15 * ourTurn);

            const contactsDiff = F.foundation.getContacts().filter(c => !theirContacts.has(c.id));
            if (contactsDiff.length) {
                await sendContacts(senderThread, senderDevice, contactsDiff);
            }
            /* By shuffling threads and messages we partner better with other peers sending data.
             * This allows the requestor to process results from multiple clients more
             * effectively.  It also adds eventual consistency in the case of a thread/msg that
             * wedges the process every time. */
            for (const thread of F.foundation.allThreads.shuffle()) {
                const messages = new F.MessageCollection([], {thread});
                await messages.fetchAll();
                const messagesDiff = _.shuffle(messages.filter(m => !theirMessages.has(m.id)));
                _.shuffle(messagesDiff);
                while (messagesDiff.length) {
                    await sendMessages(senderThread, senderDevice, messagesDiff.splice(0, 100));
                }
                const ts = theirThreads.get(thread.id);
                if (!ts || ts < new Date(thread.get('timestamp'))) {
                    await sendThreads(senderThread, senderDevice, [thread]);
                }
            }
            console.info("Fullfilled sync request:", ev.id);
        } finally {
            removeEventListener('syncResponse', onPeerResponse);
        }
    };
})();
 
