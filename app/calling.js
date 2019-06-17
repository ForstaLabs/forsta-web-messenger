// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.calling = {};
    const logger = F.log.getLogger('calling');
    const callManagers = new Map();


    class CallManager extends F.AsyncEventTarget {

        constructor(callId, thread) {
            super();
            this.callId = callId;
            this.thread = thread;
            this._ignoring = false;
            this.originator = null;
            this.members = null;
            this.view = null;
            this._starting = false;
            this._peers = new Map();
            this._activityRefs = new Set();
            this._gcInterval = setInterval(this._gc.bind(this), 5000);
        }

        addThreadActivity(symbol) {
            this._activityRefs.add(symbol);
            this._updateThreadActivity();
        }

        removeThreadActivity(symbol) {
            this._activityRefs.delete(symbol);
            this._updateThreadActivity();
        }

        _updateThreadActivity() {
            this.thread.save({
                callActive: this._activityRefs.size ? Date.now() : false,
                callJoined: this._activityRefs.has('self-joined')
            });
        }

        _gc() {
            if (this.view) {
                return;
            }
            const lastActivityAge = Date.now() - this.thread.get('callActive');
            if (lastActivityAge > 60000) {
                logger.warn("Garbage collecting aged out call:", this.callId);
                this.destroy();
            }
        }

        async start(options) {
            options = options || {};
            if (!this._starting) {
                // Assume we are the originator.
                this._starting = true;
                this.originator = F.currentUser;
                this.members = await this.thread.getContacts(/*excludePending*/ true);
            }
            if (!this.view) {
                await this._bindCallView(options.viewOptions);
            }
            await this.view.show();
            if (options.autoJoin) {
                await this.view.join();
            }
        }

        async _startIncoming(data, type, options) {
            // Respond to an incoming establish request.
            F.assert(!this._starting, 'Already starting');
            F.assert(data.originator, 'Missing originator');
            F.assert(data.members, 'Missing members');
            options = options || {};
            this._starting = true;
            this.originator = await F.atlas.getContact(data.originator);
            this.members = await F.atlas.getContacts(data.members);
            if (!options.skipConfirm) {
                F.assert(!this._confirming);
                const ringer = await F.util.playAudio('/audio/call-ring.mp3');
                const from = this.originator.getName();
                this._confirming = F.util.confirmModal({
                    size: 'tiny',
                    icon: 'phone',
                    header: `Incoming call from ${from}`,
                    content: `Accept incoming call with ${this.thread.getNormalizedTitle()}?`,
                    confirmLabel: 'Accept',
                    confirmClass: 'green',
                    confirmHide: false,  // Managed manually to avoid transition blips.
                    dismissLabel: 'Ignore',
                    dismissClass: 'red',
                    closable: false
                });
                this._confirming.view.on('hide', () => this._confirming = null);
                const timeout = 45;
                const accept = await Promise.race([this._confirming, F.sleep(timeout)]);
                ringer.stop();
                if (accept !== true) {
                    if (accept === false) {
                        // Hit the ignore button.
                        this._ignoring = true;
                        await this.postThreadMessage(`You ignored a call from ${from}.`);
                    } else if (accept !== undefined) {
                        // Hit timeout.
                        this._confirming.view.hide();
                        await this.postThreadMessage(`You missed a call from ${from}.`);
                    }
                    this._starting = false;
                    return;
                }
                this._confirming.view.toggleLoading(true);
            }
            await this._bindCallView(options.viewOptions);
            await this.view.show();
            if (this._confirming) {
                this._confirming.view.hide();
            }
            await this.view.join({type});
            this._starting = false;
        }

        async _notifyIncoming(sender, device, data) {
            if (!F.notifications) {
                logger.error("Ignoring background call attempt on system without notifications");
                return;
            }
            const originator = await F.atlas.getContact(data.originator);
            await F.notifications.showCall(originator, sender, device, this.thread.id, data);
        }

        getPeers() {
            return Array.from(this._peers.values());
        }

        async addPeerJoin(sender, device, data, startOptions) {
            const ident = `${sender}.${device}`;
            this.addThreadActivity(ident);
            this._peers.set(ident, {sender, device});
            const tracks = new F.util.ESet(data.receives).union(new Set(data.sends));
            const joinType = (!tracks.size || tracks.has('video')) ? 'video' : 'audio';
            this.dispatch('peerjoin', {sender, device, joinType});
            if (this.view) {
                return;
            }
            if (sender === F.currentUser.id) {
                this._ignoring = true;
                if (this._confirming) {
                    this._confirming.view.hide();
                    this.postThreadMessage(`You took a call from another device.`);  // bg okay
                }
            } else if (F.isServiceWorker) {
                await this._notifyIncoming(sender, device, data);
            } else if (!this._starting) {
                // Stimulate the thread call activity status as a means of indicating new incoming
                // activity.  This is useful even if the call is being ignored so a user can see
                // the requests.
                const ringActivity = `ring:${F.util.uuid4()}`;
                this.addThreadActivity(ringActivity);
                F.sleep(30).then(() => this.removeThreadActivity(ringActivity));
                if (!this._ignoring) {
                    logger.info("Starting new call:", this.callId);
                    this._startIncoming(data, joinType, startOptions);  // bg okay
                }
            }
        }

        addPeerOffer(sender, device, data) {
            const legacyOffer = !data.version || data.version < 2;
            if (legacyOffer) {
                this.postThreadMessage(`Dropping call offer from outdated client.`);  // bg okay
                throw new Error("Legacy calling client detected");
            }
            const ident = `${sender}.${device}`;
            this.addThreadActivity(ident);
            if (!this.view) {
                logger.warn("Rejecting peer-offer for unbound call from:", ident);
                this.sendLeave();
                return;
            }
            this.dispatch('peeroffer', {sender, device, data});
        }

        addPeerAcceptOffer(sender, device, data) {
            const ident = `${sender}.${device}`;
            this.addThreadActivity(ident);
            if (!this.view) {
                logger.warn("Dropping stale peer-connection accept-offer:", ident);
                return;
            }
            this.dispatch('peeracceptoffer', {sender, device, data});
        }

        addPeerICECandidates(sender, device, data) {
            const ident = `${sender}.${device}`;
            this.addThreadActivity(ident);
            this.dispatch('peericecandidates', {sender, device, data});
        }

        addPeerLeave(sender, device, data) {
            const ident = `${sender}.${device}`;
            this.removeThreadActivity(ident);
            this._peers.delete(ident);
            this.dispatch('peerleave', {sender, device});
            if (!this._peers.size) {
                if (this._confirming) {
                    logger.warn("Call ended before we joined");
                    this._confirming.view.hide();
                }
            }
        }

        async peerHeartbeat(sender, device) {
            const ident = `${sender}.${device}`;
            logger.info("HEARTBEAT:", ident);
            this.addThreadActivity(ident);
        }

        dispatch(name, options) {
            options = options || {};
            const ev = new Event(name);
            for (const [key, value] of Object.entries(options)) {
                ev[key] = value;
            }
            return this.dispatchEvent(ev);
        }

        async sendJoin(options) {
            options = options || {};
            const sends = new Set(['audio', 'video']);
            const receives = new Set(['audio', 'video']);
            if (options.type === 'audio') {
                sends.delete('video');
                receives.delete('video');
            }
            this.addThreadActivity('self-joined');
            await this.sendControl('callJoin', {
                members: this.members.map(x => x.id),
                originator: this.originator.id,
                sends: Array.from(sends),
                receives: Array.from(receives),
            });
            this._heartbeatInterval = setInterval(this._heartbeat.bind(this), 30000);
        }

        async sendLeave() {
            this.removeThreadActivity('self-joined');
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
            await this.sendControl('callLeave');
        }

        async postThreadMessage(message) {
            await this.thread.createMessage({
                type: 'clientOnly',
                plain: message
            });
        }

        async sendControlToDevice(control, addr, data, options) {
            options = options || {};
            const addrs = [addr];
            if (options.includeSelf) {
                addrs.push(F.currentUser.id);
            }
            return await this.sendControl(control, data, {addrs});
        }

        async sendControl(control, data, sendOptions) {
            /* Serialize all controls for this callid */
            return await F.queueAsync(`call-send-control-${this.callId}`, async () => {
                return await this.thread.sendControl(Object.assign({
                    control,
                    callId: this.callId,
                    version: 2
                }, data), /*attachments*/ null, sendOptions);
            });
        }

        async _heartbeat() {
            // Called in interval loop to keep thread members aware of our
            // call participation.
            F.assert(this.view);
            await this.sendControl('callHeartbeat');
            this._updateThreadActivity();
        }

        async _bindCallView(options) {
            F.assert(!this.view, "CallView already exists");
            const iceServers = await F.atlas.getRTCServersFromCache();
            this.view = new F.CallView(Object.assign({
                manager: this,
                model: this.thread,
                callId: this.callId,
                started: Date.now(),
                iceServers,
            }, options));
            this.view.on('close', () => {
                logger.info("Call ended:", this.callId);
                this.view = null;
            });
            await this.view.setup();
        }

        destroy() {
            if (this._destroyed) {
                return;
            }
            this._destroyed = true;
            clearInterval(this._heartbeatInterval);
            clearInterval(this._gcInterval);
            if (this.view) {
                logger.error("Destroying call-manager with active view:", this.callId);
            }
            ns.deleteManager(this.callId);
        }
    }

    ns.getManagers = function() {
        return Array.from(callManagers.values());
    };

    ns.getManager = function(callId) {
        return callManagers.get(callId);
    };

    ns.deleteManager = function(callId) {
        const mgr = callManagers.get(callId);
        if (mgr) {
            mgr.destroy();
        }
        return callManagers.delete(callId);
    };

    ns.createManager = function(callId, thread) {
        F.assert(!callManagers.has(callId), "Call already exists");
        logger.info("Creating new CallManager for callId:", callId);
        const mgr = new CallManager(callId, thread);
        callManagers.set(callId, mgr);
        return mgr;
    };

    ns.getOrCreateManager = function(callId, thread) {
        return ns.getManager(callId) || ns.createManager(callId, thread);
    };
})();
