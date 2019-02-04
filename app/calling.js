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
            this.view = null;
            this._finalizing = false;
            this._pendingPeerOffers = new Map();
            this._pendingPeerJoins = new Map();
            this._confirmModal = null;
            this._viewOptions = viewOptions;
        }

        async show() {
            F.assert(!this.view, 'View already bound');
            this._finalizing = true;
            await this._bindCallView({
                members: await this.thread.getMembers(/*excludePending*/ true),
                originator: F.currentUser,
            });
            //callView.on('hide', () => this.end());  // XXX maybe not, eh?  
            await this.view.show();
        }

        async join(sender, device, data) {
            // Respond to an incoming establish request.
            F.assert(!this._finalizing, 'Already finalized');
            F.assert(data.members, 'Missing data.members');
            console.info("Received call establish request:", this.callId);
            this._finalizing = true;
            const originator = await F.atlas.getContact(sender);
            const from = originator.getName();
            const ringer = await F.util.playAudio('/audio/call-ring.ogg', {loop: true});
            const confirm = this._confirmModal = F.util.confirmModal({
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
            this._confirmModal = null;
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
            await this._bindCallView({
                established: true,
                members: data.members,
                originator,
            });
            //callView.on('hide', () => this.end());  // XXX maybe not, eh?  
            await this.view.show();
            confirm.view.hide();  // CallView is only sometimes a modal, so it won't always replace us.
            //} else if (F.activeCall.callId !== data.callId) {
            //    await this.postThreadMessage(`You missed a call from ${from} while on another call.`);
            //    return;
            //}
            await this.view.start();
        }

        addPeerJoin(sender, device, data) {
            // NOTE this is vulnerable to client side clock differences.  Clients with
            // bad clocks are going to have a bad day.  Server based timestamps would
            // be helpful here.
            debugger;
            if (!this.view) {
                const ident = `${sender}.${device}`;
                this._pendingPeerJoins.set(ident, {sender, device, data});
            } else {
                this.view.trigger('join', sender, device, data);
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
                this._pendingPeerOffers.set(ident, {sender, device, data});
            } else {
                this.view.trigger('peeroffer', sender, device, data);
            }
            const legacyOffer = !data.version || data.version < 2;
            if (legacyOffer && !this._finalizing) {
                console.warn("Joining call implicitly because of legacy callOffer from:", ident);
                // Note that while the payload for a legacy callOffer does have the "originator"
                // it can't be used since we don't actually know the device of that originator,
                // so we just treat this offer as the originator as a hack to make the protocol play
                // correctly at the expense of some UX accuracy.
                this.join(sender, device, data);
            }
        }

        addPeerAcceptOffer(sender, device, data) {
            debugger;
            if (!this.view) {
                const ident = `${sender}.${device}`;
                console.warn("Dropping peer-connection accept-offer (we already left):", ident);
                return;
            }
            this.view.trigger('peeracceptoffer', sender, device, data);
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
        }
    }


    ns.getManager = function(callId) {
        return callManagers.get(callId);
    };

    ns.createManager = function(callId, thread) {
        F.assert(!callManagers.has(callId), "Call already exists");
        console.info("Creating new CallManager for callId:", callId);
        const mgr = new CallManager(callId, thread);
        callManagers.set(callId, mgr);
        return mgr;
    };
})();
