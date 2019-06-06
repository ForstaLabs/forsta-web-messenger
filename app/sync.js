// vim: ts=4:sw=4:expandtab
/* global platform */

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.sync = {};
    const logger = F.log.getLogger('sync');


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
            F.assert(typeof type === 'string');
            options = options || {};
            this.devices = options.devices;
            this.ttl = options.ttl;
            const devicesStmt = options.devices ? options.devices.join() : '<All Devices>';
            logger.info(`Starting sync request [${type}] with: ${devicesStmt}`, this.id);
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
                logger.warn("No devices to sync with");
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
            const updated = {
                threads: new Set(),
                messages: new Set(),
                contacts: new Set()
            };
            const sourceDevice = ev.data.message.get('sourceDevice');

            logger.info(`Handling content history sync response from ${sourceDevice}: ` +
                        `${candidates.threads.length} threads, ` +
                        `${candidates.messages.length} messages, ` +
                        `${candidates.contacts.length} contacts.`);

            for (const t of candidates.threads) {
                const ours = F.foundation.allThreads.get(t.id);
                if (!ours || ours.get('timestamp') < t.timestamp) {
                    await F.foundation.allThreads.add(t, {merge: true}).save();
                    updated.threads.add(t.id);
                    this.stats.threads++;
                }
            }

            const msgSaves = [];
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
                            x.id = allAttachments[x.index].id.toString();
                            x.key = allAttachments[x.index].key.toArrayBuffer();
                            delete x.index;
                        }
                    }
                    msgSaves.push(mCol.add(m, {merge: true}).save());
                    updated.messages.add(m.id);
                    updated.threads.add(m.threadId);
                    this.stats.messages++;
                }
            }
            await Promise.all(msgSaves);

            const ourContacts = F.foundation.getContacts();
            const newContacts = [];
            for (const c of candidates.contacts) {
                if (typeof c === 'string') {
                    logger.warn("Dropping legacy version contact sync.");
                    break;
                }
                const ours = ourContacts.get(c.id);
                if (!ours || ours.get('updated') < c.updated) {
                    newContacts.push(c);
                }
            }
            const updatedContacts = await F.atlas.getContacts(newContacts.map(x => x.id));
            for (let i = 0; i < updatedContacts.length; i++) {
                const contact = updatedContacts[i];
                if (contact) {
                    // XXX We over update here.
                    await contact.save(newContacts[i]);
                    updated.contacts.add(contact.id);
                    this.stats.contacts++;
                }
            }
            await this._dispatchResponseEvent(response, {updated});
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

        async _dispatchResponseEvent(data, extra) {
            const ev = new Event('response');
            ev.request = this;
            ev.data = data;
            Object.assign(ev, extra);
            await this.dispatchEvent(ev);
        }
    }
    ns.Request = Request;


    class Responder {

        constructor(id, sourceDevice) {
            this.id = id;
            this.sourceDevice = sourceDevice;
            this.thread = new F.Thread({id}, {deferSetup: true});
        }

        async sendResponse(data, attachments) {
            const msg = await this.thread.sendSyncControl(Object.assign({
                control: 'syncResponse',
                device: this.sourceDevice
            }, data), attachments);
            const done = new Promise((resolve, reject) => {
                msg.on('sent', resolve);
                msg.on('error', ev => reject(ev.error));
            });
            try {
                const timeout = 60;
                if (await Promise.race([done, F.sleep(timeout)]) === timeout) {
                    logger.error("Sync Send Timeout:", timeout);
                }
            } catch(e) {
                logger.error('Sync Send Error:', e);
            }
        }

        async process(request) {
            throw new Error('Virtual Method Not Implemented');
        }
    }


    class ContentHistoryResponder extends Responder {

        async process(request) {
            if (request.knownContacts && typeof request.knownContacts[0] === 'string') {
                logger.warn("Ignoring legacy contacts format.");
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
                    const delay = Math.random() * (offset * 5);
                    logger.info("Delay sync-request response for:", delay);
                    await F.sleep(delay);
                }
                await this._process(request);
            } finally {
                removeEventListener('syncResponse', onPeerResponse);
            }
        }

        async enqueueMessages(messages) {
            const remaining = Array.from(messages);
            const max = 200;
            if (!this._msgQueue) {
                this._msgQueue = [];
            }
            while (remaining.length) {
                const space = max - this._msgQueue.length;
                this._msgQueue.push.apply(this._msgQueue, remaining.splice(0, space));
                if (this._msgQueue.length >= max) {
                    await this.flushMessages();
                }
            }
        }

        async enqueueThread(thread) {
            const max = 20;
            if (!this._threadQueue) {
                this._threadQueue = [];
            }
            this._threadQueue.push(thread);
            if (this._threadQueue.length >= max) {
                await this.flushMessages();
                await this.flushThreads();
            }
        }

        async flushMessages() {
            if (!this._msgQueue.length || !this._msgQueue.length) {
                return;
            }
            await this.sendMessages(this._msgQueue);
            this._msgQueue.length = 0;
        }

        async flushThreads() {
            if (!this._threadQueue || !this._threadQueue.length) {
                return;
            }
            await this.sendThreads(this._threadQueue);
            this._threadQueue.length = 0;
        }

        async _process(request) {
            logger.info("Starting sync-request response:", this.id);
            const contactsDiff = F.foundation.getContacts().filter(ours => {
                const theirs = this.theirContacts.get(ours.id);
                return !theirs || ours.get('updated') > theirs;
            });
            const stats = {
                contacts: contactsDiff.length,
                threads: 0,
                messages: 0
            };
            if (contactsDiff.length) {
                await this.sendContacts(contactsDiff);
            }
            /* By shuffling threads we partner better with other peers
             * sending data.  This allows the requester to process results from
             * multiple clients more effectively.
             */
            for (const thread of F.foundation.allThreads.shuffle()) {
                const messages = new F.MessageCollection([], {thread});
                await messages.fetchAll();
                const messagesDiff = messages.filter(m =>
                    !m.isClientOnly() && !this.theirMessages.has(m.id));
                stats.messages += messagesDiff.length;
                await this.enqueueMessages(messagesDiff);
                const ts = this.theirThreads.get(thread.id);
                if (!ts || ts < thread.get('timestamp')) {
                    stats.threads++;
                    await this.enqueueThread(thread);
                }
            }
            await this.flushMessages();
            await this.flushThreads();
            logger.info(`Fulfilled sync request for device ${this.sourceDevice}: ` +
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
                    logger.warn("Ignoring legacy contact sync from peer.");
                    break;
                }
                this.theirContacts.set(c.id, c.updated);
            }
        }

        async sendMessages(messages) {
            logger.info(`Synchronizing ${messages.length} messages with device:`,
                        this.sourceDevice);
            const allAttachments = [];
            await this.sendResponse({
                messages: messages.map(model => {
                    const m = model.attributes;
                    const attachments = [];
                    if (m.attachments) {
                        for (const x of m.attachments) {
                            const index = allAttachments.push(x) - 1;
                            const proxy = Object.assign({index}, x);
                            delete proxy.data;  // Do not even attempt to parse.
                            // Remove redundant attachment pointer properties.
                            delete proxy.id;
                            delete proxy.key;
                            attachments.push(proxy);
                        }
                    }
                    return {
                        attachments,
                        expiration: m.expiration,
                        expirationUpdate: m.expirationUpdate,
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
                        replies: m.replies,
                        safe_html: m.safe_html,
                        sender: m.sender,
                        senderDevice: m.senderDevice,
                        source: m.source,
                        sourceDevice: m.sourceDevice,
                        sent: m.sent,
                        threadId: m.threadId,
                        type: m.type,
                        userAgent: m.userAgent,
                        actions: m.actions,
                        actionOptions: m.actionOptions,
                        action: m.action,
                        serverAge: m.serverAge,
                        timestamp: m.timestamp
                    };
                })
            }, allAttachments);
        }

        async sendThreads(threads) {
            logger.info(`Synchronizing ${threads.length} threads with device:`,
                        this.sourceDevice);
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
                        readMarks: t.readMarks
                    };
                })
            });
        }

        async sendContacts(contacts) {
            logger.info(`Synchronizing ${contacts.length} contacts with device:`,
                        this.sourceDevice);
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
            await Promise.race([F.sleep(5), this._getLocation()]);
            return await F.state.get('lastLocation');
        }

        async _getLocation() {
            if (!navigator.geolocation) {
                logger.warn("Geo Location not supported");
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
                logger.warn("Ignore geolocation error:", e);
                return;
            }
            await F.state.put('lastLocation', location);
            return location;
        }
    }

    ns.processRequest = async function(ev) {
        if (F.util.isCellular()) {
            logger.warn("Ignoring sync request because of cellular connection");
            return;
        }
        const message = ev.data.message;
        const exchange = ev.data.exchange;
        const request = exchange.data;
        const sourceDevice = message.get('sourceDevice');
        logger.info("Handling sync request:", request.type, ev.id);
        let responder;
        if (request.type === 'contentHistory') {
            responder = new ContentHistoryResponder(ev.id, sourceDevice);
        } else if (request.type === 'deviceInfo') {
            responder = new DeviceInfoResponder(ev.id, sourceDevice);
        } else {
            throw new Error("Unexpected sync-request type: " + request.type);
        }
        await responder.process(request);
    };
})();
