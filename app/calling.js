// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.calling = {};
    const callManagers = new Map();


    class CallManager {

        constructor(callId, thread, viewOptions) {
            this.callId = callId;
            this.thread = thread;
            this.ignoring = false;
            this.originator = null;
            this.members = null;
            this.view = null;
            this._finalizing = false;
            this._pendingPeerOffers = new Map();
            this._pendingPeerJoins = new Map();
            this._viewOptions = viewOptions;
        }

        async startOutgoing() {
            F.assert(!this.view, 'View already bound');
            this._finalizing = true;
            this.originator = F.currentUser;
            this.members = await this.thread.getContacts(/*excludePending*/ true);
            await this._bindCallView();
            await this.view.show();
        }

        async _startIncoming(originator, members, options) {
            // Respond to an incoming establish request.
            F.assert(!this._finalizing, 'Already finalized');
            F.assert(originator, 'Missing originator');
            F.assert(members, 'Missing members');
            options = options || {};
            this._finalizing = true;
            this.originator = await F.atlas.getContact(originator);
            this.members = await F.atlas.getContacts(members);
            let confirm;
            if (!options.skipConfirm) {
                const ringer = await F.util.playAudio('/audio/call-ring.ogg', {loop: true});
                const from = this.originator.getName();
                confirm = F.util.confirmModal({
                    size: 'tiny',
                    icon: 'phone',
                    header: `Incoming call from ${from}`,
                    content: `Accept incoming call with ${this.thread.getNormalizedTitle()}?`,
                    confirmLabel: 'Accept',
                    confirmClass: 'green',
                    confirmHide: false,  // Managed manually to avoid transition blips.
                    dismissLabel: 'Ignore',
                    dismissClass: 'red'
                });
                const timeout = 30;
                const accept = await Promise.race([confirm, relay.util.sleep(timeout)]);
                ringer.stop();
                if (accept !== true) {
                    if (accept === false || accept === undefined) {
                        this.ignoring = true;
                        await this.postThreadMessage(`You ignored a call from ${from}.`);
                    } else {
                        // Hit timeout.
                        confirm.view.hide();
                        await this.postThreadMessage(`You missed a call from ${from}.`);
                    }
                    return;
                }
                confirm.view.toggleLoading(true);
            }
            await this._bindCallView({established: true});
            //callView.on('hide', () => this.end());  // XXX maybe not, eh?  
            await this.view.show();
            if (confirm) {
                confirm.view.hide();  // CallView is only sometimes a modal, so it won't always replace us.
            }
            //} else if (F.activeCall.callId !== data.callId) {
            //    await this.postThreadMessage(`You missed a call from ${from} while on another call.`);
            //    return;
            //}
            await this.view.start();
        }

        addPeerJoin(sender, device, data, startOptions) {
            // NOTE this is vulnerable to client side clock differences.  Clients with
            // bad clocks are going to have a bad day.  Server based timestamps would
            // be helpful here.
            const ident = `${sender}.${device}`;
            if (!this._finalizing || !this.view) {
                console.debug("Queueing peer-join:", ident);
                this._pendingPeerJoins.set(ident, {sender, device, data});
                if (!this._finalizing) {
                    console.info("Starting new call:", this.callId);
                    this._startIncoming(data.originator, data.members, startOptions);
                }
            } else {
                console.debug("Triggering peer-join:", ident);
                this.view.trigger('peerjoin', sender, device, data);
            }
            /*if (F.mainView) {
                F.util.answerCall(this.get('sender'), this.get('senderDevice'), thread, exchange.data);  // bg required
            } else if (self.registration) {
                // Service worker context, notify the user that the call is incoming..
                const caller = await this.getSender();
                self.registration.showNotification(`Incoming call from ${caller.getName()}`, {
                    icon: await caller.getAvatarURL(),
                    tag: `${thread.id}?callOffer&caller=${this.get('sender')}&sent=${this.get('sent')}`,
                    body: 'Click to accept call'
                });
                F.util.playAudio('audio/call-ring.ogg');  // Will almost certainly fail.
            }*/
        }

        addPeerOffer(sender, device, data) {
            const ident = `${sender}.${device}`;
            if (!this.view) {
                console.debug("Queueing peer-offer:", ident);
                this._pendingPeerOffers.set(ident, {sender, device, data});
            } else {
                console.debug("Triggering peer-offer:", ident);
                this.view.trigger('peeroffer', sender, device, data);
            }
            const legacyOffer = !data.version || data.version < 2;
            if (legacyOffer && !this._finalizing) {
                console.warn("Joining call implicitly because of legacy callOffer from:", ident);
                debugger; // XXX
                this._startIncoming(data.originator, data.members);
            }
        }

        addPeerAcceptOffer(sender, device, data) {
            const ident = `${sender}.${device}`;
            if (!this.view) {
                console.warn("Dropping stale peer-connection accept-offer:", ident);
            } else {
                console.debug("Triggering peer-accept-offer:", ident);
                this.view.trigger('peeracceptoffer', sender, device, data);
            }
        }

        addPeerICECandidates(sender, device, data) {
            if (!this.view) {
                const ident = `${sender}.${device}`;
                console.warn("Dropping peer-connection ice-candidates (we already left):", ident);
                return;
            }
            this.view.trigger('peericecandidates', sender, device, data);
        }

        addPeerLeave(sender, device, data) {
            if (!this.view) {
                const ident = `${sender}.${device}`;
                console.info("Peer left before we joined:", ident);
                this._pendingPeerOffers.delete(ident);
                this._pendingPeerJoins.delete(ident);
            } else {
                this.view.trigger('peerleave', sender, device, data);
            }
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
                }, data), /*attachments*/ null, sendOptions);
            });
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
                console.info("Deleted Call:", this.callId);
                ns.deleteManager(this.callId);
            });
            this.view.setOutStream(await this.view.getOutStream());
            const peerJoins = Array.from(this._pendingPeerJoins.values());
            this._pendingPeerJoins = null;
            for (const x of peerJoins) {
                this.view.trigger('peerjoin', x.sender, x.device, x.data);
            }
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
})();
