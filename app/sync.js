// vim: ts=4:sw=4:expandtab
/* global relay, platform */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.sync = {};

    class Request extends F.AsyncEventTarget {

        constructor() {
            super();
            this.syncThread = new F.Thread({}, {deferSetup: true});
            this.id = this.syncThread.id;
            this.stats = {
                messages: 0,
                threads: 0,
                contacts: 0
            };
            this._messageCollections = new Map();
        }

        async start(type, data, options) {
            console.assert(typeof type === 'string');
            options = options || {};
            this.devices = options.devices;
            this.ttl = options.ttl;
            const devicesStmt = options.devices ? options.devices.join() : '<All Devices>';
            console.info(`Starting sync request [${type}] with: ${devicesStmt}`, this.id);
            await this.syncThread.sendSyncControl(Object.assign({
                control: 'syncRequest',
                devices: this.devices,
                ttl: this.ttl,
                type
            }, data));
            const ev = new Event('started');
            ev.request = this;
            await this.dispatchEvent(ev);
        }

        _bindEventListener(listener) {
            // TODO: cleanup listener when "done".
            if (this._bound) {
                throw new Error("Request cannot be reused");
            }
            this._bound = true;
            addEventListener('syncResponse', ev => {
                if (ev.id === this.id) {
                    F.queueAsync('sync:' + this.id, () => listener(ev));
                }
            });
        }

        async syncContentHistory(options) {
            options = options || {};
            if (!options.devices) {
                const tooOld = Date.now() - (86400 * 3 * 1000);
                let fullDevices = await F.atlas.getDevices();
                fullDevices = fullDevices.filter(x => x.id !== F.currentDevice && x.lastSeen > tooOld);
                fullDevices.sort((a, b) => a.created - b.created);
                options.devices = fullDevices.map(x => x.id);
            }
            if (!options.devices.length) {
                console.warn("No devices to sync with");
                const ev = new Event('aborted');
                ev.request = this;
                ev.reason = 'no-devices';
                await this.dispatchEvent(ev);
                return;
            }
            if (options.ttl === undefined) {
                options.ttl = 300 * 1000;
            }
            const ev = new Event('starting');
            ev.request = this;
            await this.dispatchEvent(ev);
            /* Collect our own content into a manifest that acts as an exclude
             * list to the responders. */
            const knownMessages = [];
            const knownThreads = [];
            const knownContacts = F.foundation.getContacts().map(x => ({
                id: x.id,
                updated: x.get('updated')
            }));
            for (const thread of F.foundation.allThreads.models) {
                const mc = new F.MessageCollection([], {thread});
                await mc.fetchAll();
                for (const m of mc.models) {
                    if (!m.isClientOnly()) {
                        knownMessages.push(m.id);
                    }
                }
                knownThreads.push({
                    id: thread.id,
                    lastActivity: thread.get('timestamp')
                });
            }
            this._bindEventListener(this.onContentHistoryResponse.bind(this));
            await this.start('contentHistory', {
                knownMessages,
                knownThreads,
                knownContacts
            }, options);
        }

        async syncDeviceInfo(options) {
            this._bindEventListener(this.onDeviceInfoResponse.bind(this));
            const ev = new Event('starting');
            ev.request = this;
            await this.dispatchEvent(ev);
            await this.start('deviceInfo', undefined, options);
        }

        async onContentHistoryResponse(ev) {
            const response = ev.data.exchange.data;
            const allAttachments = ev.data.attachments;
            const candidates = {
                threads: response.threads || [],
                messages: response.messages || [],
                contacts: response.contacts || []
            };
            const senderDevice = ev.data.message.get('senderDevice');
            console.info(`Handling content history sync response from ${senderDevice}: ` +
                         `${candidates.threads.length} threads, ` +
                         `${candidates.messages.length} messages, ` +
                         `${candidates.contacts.length} contacts.`);
            for (const t of candidates.threads) {
                const existing = F.foundation.allThreads.get(t.id);
                if (!existing || existing.get('timestamp') < t.timestamp) {
                    await F.foundation.allThreads.add(t, {merge: true}).save();
                    this.stats.threads++;
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
                    await mCol.add(m, {merge: true}).save();
                    this.stats.messages++;
                }
            }
            const ourContacts = F.foundation.getContacts();
            const newContacts = [];
            for (const c of candidates.contacts) {
                if (typeof c === 'string') {
                    console.warn("Dropping legacy version contact sync.");
                    break;
                }
                const existing = ourContacts.get(c.id);
                if (!existing || existing.get('updated') < c.updated) {
                    newContacts.push(c);
                }
            }
            const updatedContacts = await F.atlas.getContacts(newContacts.map(x => x.id));
            for (let i = 0; i < updatedContacts.length; i++) {
                await updatedContacts[i].save(newContacts[i]);
            }
            this.stats.contacts += newContacts.length;
            await this._dispatchResponseEvent(response);
        }

        async onDeviceInfoResponse(ev) {
            /* Merge in new data into our `ourDevices` state. */
            const info = ev.data.exchange.data.deviceInfo;
            const ourDevices = (await F.state.get('ourDevices')) || new Map();
            const existing = ourDevices.get(info.id) || {};
            const curLocTs = info.lastLocation && info.lastLocation.timestamp;
            const prevLocTs = existing.lastLocation && existing.lastLocation.timestamp;
            if (curLocTs && (!prevLocTs || curLocTs > prevLocTs)) {
                info.geocode = await F.util.reverseGeocode(info.lastLocation.latitude,
                                                           info.lastLocation.longitude);
            }
            ourDevices.set(info.id, Object.assign(existing, info));
            await F.state.put('ourDevices', ourDevices);
            await this._dispatchResponseEvent(ev.data.exchange.data);
        }

        async _dispatchResponseEvent(data) {
            const ev = new Event('response');
            ev.request = this;
            ev.data = data;
            await this.dispatchEvent(ev);
        }
    }
    ns.Request = Request;


    class Responder {

        constructor(id, senderDevice) {
            this.id = id;
            this.senderDevice = senderDevice;
            this.senderThread = new F.Thread({id}, {deferSetup: true});
        }

        async sendResponse(data, attachments) {
            return await this.senderThread.sendSyncControl(Object.assign({
                control: 'syncResponse',
                device: this.senderDevice
            }, data), attachments);
        }

        async process(request) {
            throw new Error('Virtual Method Not Implemented');
        }
    }


    class ContentHistoryResponder extends Responder {

        async process(request) {
            if (request.knownContacts && typeof request.knownContacts[0] === 'string') {
                console.warn("Ignoring legacy contacts format.");
                this.theirContacts = new Map();
            } else {
                this.theirContacts = new Map(request.knownContacts.map(x => [x.id, x.updated]));
            }
            this.theirThreads = new Map(request.knownThreads.map(x => [x.id, x.lastActivity]));
            this.theirMessages = new Set(request.knownMessages);
            const onPeerResponse = this.onPeerResponse.bind(this);
            addEventListener('syncResponse', onPeerResponse);
            try {
                /* Stagger our start based on our location in the request's devices
                 * array.  Our position indicates our priority and we should allow
                 * devices in front of us opportunity to fulfill the request first. */
                if (request.devices) {
                    const offset = request.devices.indexOf(F.currentDevice);
                    if (offset === -1) {
                        throw new Error("Sync-request not intended for us");
                    }
                    const delay = offset * 15;
                    console.info("Delay sync-request response for:", delay);
                    await relay.util.sleep(delay);
                }
                await this._process(request);
            } finally {
                removeEventListener('syncResponse', onPeerResponse);
            }
        }

        async _process(request) {
            console.info("Starting sync-request response:", this.id);
            const contactsDiff = F.foundation.getContacts().filter(ours => {
                const theirUpdated = this.theirContacts.get(ours.id);
                return !theirUpdated || ours.get('updated') > theirUpdated;
            });
            const stats = {
                contacts: contactsDiff.length,
                threads: 0,
                messages: 0
            };
            if (contactsDiff.length) {
                await this.sendContacts(contactsDiff);
            }
            /* By shuffling threads and messages we partner better with other peers
             * sending data.  This allows the requester to process results from
             * multiple clients more effectively.  It also adds eventual consistency
             * in the case of a thread/msg that wedges the process every time. */
            for (const thread of F.foundation.allThreads.shuffle()) {
                const messages = new F.MessageCollection([], {thread});
                await messages.fetchAll();
                const messagesDiff = messages.shuffle().filter(m =>
                    !m.isClientOnly() && !this.theirMessages.has(m.id));
                stats.messages += messagesDiff.length;
                while (messagesDiff.length) {
                    await this.sendMessages(messagesDiff.splice(0, 100));
                }
                const ts = this.theirThreads.get(thread.id);
                if (!ts || ts < thread.get('timestamp')) {
                    stats.threads++;
                    await this.sendThreads([thread]);
                }
            }
            console.info(`Fulfilled sync request for device ${this.senderDevice}: ` +
                         `${stats.threads} threads, ${stats.messages} messages, ` +
                         `${stats.contacts} contacts.`, this.id);
        }

        onPeerResponse(ev) {
            /* Eliminate redundancy by monitoring peer responses. */
            if (ev.id !== this.id) {
                return;
            }
            const peerResponse = ev.data.exchange.data;
            for (const t of (peerResponse.threads || [])) {
                const ourThread = F.foundation.allThreads.get(t.id);
                if (ourThread && ourThread.get('timestamp') <= t.timestamp) {
                    this.theirThreads.set(t.id, t.timestamp);
                }
            }
            for (const m of (peerResponse.messages || [])) {
                this.theirMessages.add(m.id);
            }
            for (const c of (peerResponse.contacts || [])) {
                if (typeof c === 'string') {
                    console.warn("Ignoring legacy contact sync from peer.");
                    break;
                }
                this.theirContacts.set(c.id, c.updated);
            }
        }

        async sendMessages(messages) {
            console.info(`Synchronizing ${messages.length} messages with device:`,
                         this.senderDevice);
            const allAttachments = [];
            await this.sendResponse({
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
                        flags: m.flags,
                        id: m.id,
                        incoming: m.incoming,
                        keyChange: m.keyChange,
                        members: m.members,
                        mentions: m.mentions,
                        messageRef: m.messageRef,
                        monitors: m.monitors,
                        pendingMembers: m.pendingMembers,
                        plain: m.plain,
                        read: m.read,
                        received: m.received,
                        safe_html: m.safe_html,
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

        async sendThreads(threads) {
            console.info(`Synchronizing ${threads.length} threads with device:`,
                         this.senderDevice);
            await this.sendResponse({
                threads: threads.map(thread => {
                    const t = thread.attributes;
                    return {
                        blocked: t.blocked,
                        distribution: t.distribution,
                        id: t.id,
                        lastMessage: t.lastMessage,
                        left: t.left,
                        pendingMembers: t.pendingMembers,
                        pinned: t.pinned,
                        position: t.position,
                        sender: t.sender,
                        sent: t.sent,
                        started: t.started,
                        timestamp: t.timestamp,
                        title: t.title,
                        type: t.type,
                        unreadCount: t.unreadCount,
                    };
                })
            });
        }

        async sendContacts(contacts) {
            console.info(`Synchronizing ${contacts.length} contacts with device:`,
                         this.senderDevice);
            await this.sendResponse({
                contacts: contacts.map(contact => {
                    const c = contact.attributes;
                    return {
                        blocked: c.blocked,
                        id: c.id,
                        updated: c.updated,
                    };
                })
            });
        }
    }


    class DeviceInfoResponder extends Responder {

        async process(request) {
            const conn = navigator.connection || {};
            const connectionType = conn.type || conn.effectiveType;
            const deviceInfo = {
                id: F.currentDevice,
                lastLocation: await this.getLocation(),
                userAgent: F.userAgent,
                platform: platform.toString(),
                version: F.version,
                name: await F.state.get('name'),
                lastSync: await F.state.get('lastSync'),
                connectionType,
                lastIP: F.env.CLIENT_IP
            };
            await this.sendResponse({deviceInfo});
        }

        async getLocation() {
            await Promise.race([relay.util.sleep(5), this._getLocation()]);
            return await F.state.get('lastLocation');
        }

        async _getLocation() {
            if (!navigator.geolocation) {
                console.warn("Geo Location not supported");
                return;
            }
            let location;
            try {
                location = await new Promise((resolve, reject) =>
                    navigator.geolocation.getCurrentPosition(pos => resolve({
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        accuracy: pos.coords.accuracy,
                        altitude: pos.coords.altitude,
                        altitudeAccuracy: pos.coords.altitudeAccuracy,
                        heading: pos.coords.heading,
                        speed: pos.coords.speed,
                        timestamp: pos.timestamp
                    }), reject));
            } catch(e) {
                console.warn("Ignore geolocation error:", e);
                return;
            }
            await F.state.put('lastLocation', location);
            return location;
        }
    }

    ns.processRequest = async function(ev) {
        const message = ev.data.message;
        const exchange = ev.data.exchange;
        const request = exchange.data;
        const senderDevice = message.get('senderDevice');
        console.debug("Sync request data:", request);
        if (request.ttl && (Date.now() - message.get('sent')) > request.ttl) {
            console.warn("Dropping stale sync request from device:", senderDevice);
            return;
        }
        console.info("Handling sync request:", request.type, ev.id);
        let responder;
        if (request.type === 'contentHistory') {
            responder = new ContentHistoryResponder(ev.id, senderDevice);
        } else if (request.type === 'deviceInfo') {
            responder = new DeviceInfoResponder(ev.id, senderDevice);
        } else {
            throw new Error("Unexpected sync-request type: " + request.type);
        }
        await responder.process(request);
    };
})();
