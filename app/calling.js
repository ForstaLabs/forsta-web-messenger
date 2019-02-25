// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.calling = {};
    const callManagers = new Map();


    class CallManager extends EventTarget {

        constructor(callId, thread, viewOptions) {
            super();
            this.callId = callId;
            this.thread = thread;
            this.ignoring = false;
            this.originator = null;
            this.members = null;
            this.view = null;
            this._starting = false;
            this._peers = new Map();
            this._viewOptions = viewOptions;
            this._activityRefs = new Set();
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
            this.thread.set('callActive', this._activityRefs.size > 1 ? Date.now() : false);
        }

        async start() {
            if (!this._starting) {
                // Assume we are the originator.
                this._starting = true;
                this.originator = F.currentUser;
                this.members = await this.thread.getContacts(/*excludePending*/ true);
            }
            if (!this.view) {
                await this._bindCallView();
            }
            await this.view.show();
        }

        async _startIncoming(originator, members, options) {
            // Respond to an incoming establish request.
            F.assert(!this._starting, 'Already starting');
            F.assert(originator, 'Missing originator');
            F.assert(members, 'Missing members');
            options = options || {};
            this._starting = true;
            this.originator = await F.atlas.getContact(originator);
            this.members = await F.atlas.getContacts(members);
            if (!options.skipConfirm) {
                F.assert(!this._confirming);
                const ringer = await F.util.playAudio('/audio/call-ring.ogg', {loop: true});
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
                const accept = await Promise.race([this._confirming, relay.util.sleep(timeout)]);
                ringer.stop();
                if (accept !== true) {
                    if (accept === false || accept === undefined) {
                        this.ignoring = true;
                        await this.postThreadMessage(`You ignored a call from ${from}.`);
                    } else {
                        // Hit timeout.
                        this._confirming.view.hide();
                        await this.postThreadMessage(`You missed a call from ${from}.`);
                    }
                    return;
                }
                this._confirming.view.toggleLoading(true);
            }
            await this._bindCallView({established: true});
            await this.view.show();
            if (this._confirming) {
                this._confirming.view.hide();
            }
            await this.view.start();
        }

        async _notifyIncoming(sender, device, data) {
            if (!F.notifications) {
                console.error("Ignoring background call attempt on system without notifications");
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
            this.dispatch('peerjoin', {sender, device});
            if (sender === F.currentUser.id || data.originator === F.currentUser.id) {
                if (this._confirming) {
                    this._confirming.view.hide();
                    this.postThreadMessage(`You took a call from another device.`);  // bg okay
                }
            } else if (F.isServiceWorker) {
                await this._notifyIncoming(sender, device, data);
            } else if (!this._starting) {
                console.info("Starting new call:", this.callId);
                this._startIncoming(data.originator, data.members, startOptions);  // bg okay
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
                console.error("Dropping peer-offer for unbound call from:", ident);
                return;
            }
            this.dispatch('peeroffer', {sender, device, data});
        }

        addPeerAcceptOffer(sender, device, data) {
            const ident = `${sender}.${device}`;
            this.addThreadActivity(ident);
            if (!this.view) {
                console.warn("Dropping stale peer-connection accept-offer:", ident);
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
        }

        dispatch(name, options) {
            options = options || {};
            const ev = new Event(name);
            for (const [key, value] of Object.entries(options)) {
                ev[key] = value;
            }
            return this.dispatchEvent(ev);
        }

        async join() {
            this.addThreadActivity('self-joined');
            this._monitorConnectionsInterval = setInterval(() => this._monitorConnections(), 1000);
            await this.sendControl('callJoin');
        }

        async leave() {
            this.removeThreadActivity('self-joined');
            clearInterval(this._monitorConnectionsInterval);
            this._monitorConnectionsInterval = null;
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
                    members: this.members.map(x => x.id),
                    callId: this.callId,
                    originator: this.originator.id,
                    version: 2
                }, data), /*attachments*/ null, sendOptions);
            });
        }

        _monitorConnections() {
            // Called in interval loop to see if any peer connections are alive.
            // If so, keep the thread's callActive timestamp updated.
            if (!this.view) {
                return;
            }
            for (const view of this.view.getMemberViews()) {
                if (view.isConnected()) {
                    this._updateThreadActivity();
                    return;
                }
            }
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
            this.view.on('hide', () => {
                console.info("Call ended:", this.callId);
                this.view = null;
                ns.deleteManager(this.callId);
            });
            this.view.setOutStream(await this.view.getOutStream());
        }
    }


    ns.getManager = function(callId) {
        return callManagers.get(callId);
    };

    ns.deleteManager = function(callId) {
        // XXX cleanup?
        return callManagers.delete(callId);
    };

    ns.createManager = function(callId, thread) {
        F.assert(!callManagers.has(callId), "Call already exists");
        console.info("Creating new CallManager for callId:", callId);
        const mgr = new CallManager(callId, thread);
        callManagers.set(callId, mgr);
        return mgr;
    };

    ns.getOrCreateManager = function(callId, thread) {
        return ns.getManager(callId) || ns.createManager(callId, thread);
    };
})();
