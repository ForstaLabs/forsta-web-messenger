// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    F.CallView = F.ModalView.extend({

        template: 'views/call.html',
        className: 'f-call-view ui modal',

        initialize: function(options) {
            this.sessions = new Map();
            this.pending = new Map();
            this.callId = options.callId;
            this.originator = options.originator;
            this.members = options.members;
            this.memberViews = new Map();
            this.on('peericecandidate', this.onPeerICECandidate);
            this.on('peeracceptoffer', this.onPeerAcceptOffer);
            this.on('peerleave', this.onPeerLeave);
            this.on('join', this.onJoin);
            this.on('leave', this.onLeave);
            this._presenter = null;
            F.ModalView.prototype.initialize(options);
        },

        events: {
            'click .f-join-call.button': 'join',
            'click .f-leave-call.button': 'leave',
            'click .f-audience .f-call-member': 'onClickAudience',
            'click .f-presenter .f-call-member': 'onClickPresenter',
            'click .f-video-mute.button': 'onVideoMuteClick',
            'click .f-audio-mute.button': 'onAudioMuteClick',
            'click .f-select-source.button': 'onSelectSourceClick',
        },

        render_attributes: function() {
            return {
                thread: this.model
            };
        },

        render: async function() {
            F.assert(!this._rendered);
            // Skip modal render which we don't want.
            await F.View.prototype.render.call(this);
            if (!this.callId) {
                // We are the originator
                F.assert(!this.members);
                F.assert(!this.originator);
                this.members = await this.model.getMembers(/*excludePending*/ true);
                this.callId = this.model.id;
                this.originator = F.currentUser.id;
                console.info("Starting new call:", this.callId);
            } else {
                F.assert(this.members);
                F.assert(this.originator);
            }
            F.assert(!this.outView);
            for (const x of this.members) {
                const view = await this.addMemberView(x);
                if (x === F.currentUser.id) {
                    this.outView = view;
                }
            }
            try {
                this.outView.bindStream(await this.getOutStream());
            } catch(e) {
                console.warn("TBD: Implement fallback strategy for view only");
            }
            this.selectPresenter(this.outView);
            this._monitor = this.startMonitor();
            return this;
        },

        addMemberView: async function(userId) {
            F.assert(!this.memberViews.has(userId));
            const order = userId === F.currentUser.id ? -1 : this.members.indexOf(userId);
            const view = new F.CallMemberView({userId, order});
            await view.render();
            this.memberViews.set(userId, view);
            this.$('.f-audience').append(view.$el);
            return view;
        },

        setStatus: function(value) {
            this.$('.f-call-status').text(value);
        },

        join: async function() {
            F.assert(!this.pending.size);
            this.joined = true;
            this.trigger('join');
            await Promise.all(this.members.filter(x => x !== F.currentUser.id).map(x => this.sendOffer(x)));
        },

        leave: function() {
            if (!this.joined) {
                return;
            }
            this.joined = false;
            for (const view of this.memberViews.values()) {
                view.trigger('leave');
                this.sendControl('callLeave', view.userId);
            }
            for (const x of this.pending.values()) {
                x.peer.close();
            }
            this.pending.clear();
            this.trigger('leave');
        },

        sendControl: async function(control, userId, data) {
            /* Serialize all controls for this callid and user */
            return await F.queueAsync(`call-send-control-${this.callId}-${userId}`, async () => {
                return await this.model.sendControl(Object.assign({
                    control,
                    members: this.members,
                    callId: this.callId,
                    originator: this.originator,
                }, data), /*attachments*/ null, {addrs: [userId]});
            });
        },

        sendOffer: async function(userId) {
            await F.queueAsync(`call-send-offer-${this.callId}-${userId}`, async () => {
                if (this.pending.has(userId)) {
                    console.warn("Skipping call offer for pending peer:", userId);
                    return;
                }
                const view = this.memberViews.get(userId);
                if (view.peer) {
                    throw new TypeError("Peer is already bound");
                }
                const peerIdentity = F.util.uuid4();
                const peer = await this.createPeerConnection(userId, peerIdentity);
                const offer = await peer.createOffer();
                view.bindPeer(peer);
                this.pending.set(userId, {peer, offer}); // probably manage through view or peer object itself.
                console.info("Sending offer to:", userId);
                await this.sendControl('callOffer', userId, {offer, peerIdentity});
            });
        },

        acceptOffer: async function(userId, data) {
            this.trigger('join');
            debugger;
            await F.queueAsync(`call-accept-offer-${this.callId}-${userId}`, async () => {
                // TODO have to rework how we detect offers for existing peer connections.
                if (this.sessions.has(userId)) {
                    console.warn('Removing stale session for:', userId);
                    this.removeSession(userId);
                }
                if (this.pending.has(userId)) {
                    console.error('Abandoning pending peer connection for:', userId);
                    this.pending.get(userId).peer.close();
                    this.pending.delete(userId);
                }
                console.info("Accepting offer from:", userId);
                const peer = await this.createPeerConnection(userId, data.peerIdentity);
                await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peer.createAnswer();
                await this.sendControl('callAcceptOffer', userId, {answer});
                await peer.setLocalDescription(answer);  // Triggers ICE events AFTER answer control is sent.
            });
        },

        getOutStream: async function() {
            try {
                return await navigator.mediaDevices.getUserMedia({audio: true, video: true});
            } catch(e) {
                this.setStatus('ERROR: ' + e.message);
                throw e;
            }
        },

        startMonitor: async function() {
            this._soundCheckInterval = setInterval(this.checkSoundLevels.bind(this), 200);
            const stop = new Promise(resolve => this._stopRepair = () => resolve('stop'));
            this._repairLoopActive = true;
            try {
                let backoff = 1;
                while (this._repairLoopActive) {
                    // We need jitter to prevent collisions.
                    const ret = await Promise.race([relay.util.sleep(Math.random() * backoff), stop]);
                    if (ret === 'stop') {
                        console.info("Stopping peer repair monitor");
                        return;
                    }
                    if (!this.joined) {
                        continue;
                    }
                    backoff *= 1.25;
                    for (const id of this.members) {
                        if (!this._repairLoopActive) {
                            break;
                        }
                        const view = this.memberViews.get(id);
                        if (id !== F.currentUser.id && !this.pending.has(id) && !view.left) {
                            console.warn("Repairing session initiated send offer");
                            await this.sendOffer(id);
                        }
                    }
                }
            } finally {
                this._repairLoopActive = false;
                this._stopRepair = null;
            }
        },

        stopMonitor: async function() {
            F.assert(this._monitor);
            clearInterval(this._soundCheckInterval);
            this._soundCheckInterval = null;
            this._repairLoopActive = false;
            this._stopRepair();
            try {
                await this._monitor;
            } finally {
                this._monitor = null;
            }
        },

        checkSoundLevels: function() {
            let loudest = this.outView;
            for (const view of this.memberViews.values()) {
                if (view.soundLevel > loudest.soundLevel) {
                    loudest = view;
                }
            }
            if (!this._presenter || !this._presenter.$el.hasClass('pinned')) {
                this.selectPresenter(loudest);
            }
        },

        selectPresenter: function(view) {
            if (this._presenter === view) {
                return;
            }
            if (this._presenter) {
                this._presenter.$el.detach().appendTo(this.$('.f-audience'));
                // XXX Workaround chrome bug that stops playback.. (try to detec in callmember view via pause ev
                this._presenter.view.$('video')[0].play().catch(e => 0);
            }
            view.$el.detach().appendTo(this.$('.f-presenter'));
            // Workaround chrome bug that stops playback..
            view.$('video')[0].play().catch(e => 0);
            this._presenter = view;
        },

        getPeerByStream: function(stream) {
            // XXX deprecated
            for (const x of this.sessions.values()) {
                if (x.stream === stream) {
                    return x.peer;
                }
            }
        },

        removeSession: function(id) {
            // XXX deprecated
            debugger;
            const session = this.sessions.get(id);
            if (!session) {
                throw new ReferenceError("Session not found");
            }
            this.sessions.delete(id);
            session.peer.close();
            if (session === this._presenter) {
                this._presenter = null;
            }
            session.view.remove();
            session.soundMeter.disconnect();
        },

        addSession: function(id, peer, stream, options) {
            // XXX deprecated
            debugger;
            F.assert(peer instanceof RTCPeerConnection);
            F.assert(stream instanceof MediaStream);
            options = options || {};
            const order = options.hasOwnProperty('order') ? options.order : this.members.indexOf(id);
            if (this.sessions.has(id)) {
                throw new Error("Already added");
            }
            const view = new F.CallMemberView({
                userId: id,
                stream,
                order
            });
            view.render();
            this.$('.f-audience').append(view.$el);
            const soundMeter = new SoundMeter(stream);
            const entry = {
                id,
                view,
                stream,
                peer,
                soundMeter
            };
            this.sessions.set(id, entry);
            return entry;
        },

        createPeerConnection: async function(userId, peerIdentity) {
            const iceServers = await F.atlas.getRTCServersFromCache();
            const peer = new RTCPeerConnection({iceServers, peerIdentity});
            peer._ident = peerIdentity;  // Workaround missing getConfiguration() and broken .peerIdentity
            peer.addEventListener('icecandidate', async ev => {
                if (!ev.candidate) {
                    return;  // Drop the empty one we start with.
                }
                console.debug("Sending ICE candidate for", userId);
                await this.sendControl('callICECandidate', userId, {
                    icecandidate: ev.candidate,
                    peerIdentity,
                });
            });
            peer.addEventListener('track', ev => {
                F.assert(ev.streams.length === 1);
                const view = this.memberViews.get(userId);
                const stream = ev.streams[0];
                if (stream != view.stream) {
                    console.info("Adding Media Stream for:", userId);
                    view.bindStream(stream);
                }
            });
            peer.addEventListener('negotiationneeded', async ev => {
                // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/onnegotiationneeded
                console.info("Not sure if we need to watch this after offer is sent?");
                return;
                //const offer = await peer.createOffer();
                //await peer.setLocalDescription(offer);
                // TBD Do we ever hit this??
                //this.pending.set(userId, {peer, offer});
                //console.info("Sending offer to:", userId);
                //await this.sendControl('callOffer', userId, {offer});
            });
            for (const track of this.outView.stream.getTracks()) {
                peer.addTrack(track, this.outView.stream);
            }
            return peer;
        },

        onPeerAcceptOffer: async function(userId, data) {
            F.assert(data.callId === this.callId);
            const pending = this.pending.get(userId);
            if (!pending) {
                // Most likely we abandoned the peer because we started our own offer.
                // Need to make sure the other side didn't also do the same.
                console.error("Dropping offer answer for invalid peer:", userId);
                return;
            }
            this.pending.delete(userId);
            console.info("Peer accepted our call offer:", userId);
            await pending.peer.setLocalDescription(pending.offer);
            await pending.peer.setRemoteDescription(new RTCSessionDescription(data.answer));
        },

        onPeerICECandidate: async function(userId, data) {
            F.assert(data.callId === this.callId);
            F.assert(data.peerIdentity);
            console.info("Received ICE Candidate for:", userId);
            let peer;
            const pending = this.pending.get(userId);
            if (pending) {
                console.warn("Received ICE candidate for pending peer", userId);
                // Misbehaving client, but we'll let it slide..
                peer = pending && pending.peer;
            } else {
                const view = this.memberViews.get(userId);
                if (!view.peer || view.peer._ident !== data.peerIdentity) {
                    debugger;
                    // Signal to client that we don't like this peer.
                    console.error("Dropping ICE candidate for peer connection we don't have:", data);
                    throw new ReferenceError("wrong peer");
                }
                peer = view.peer;
            }
            await peer.addIceCandidate(new RTCIceCandidate(data.icecandidate));
        },

        onPeerLeave: async function(userId, data) {
            console.warn('Peer left call:', userId);
            const view = this.memberViews.get(userId);
            view.trigger('left');
        },

        onClickAudience: function(ev) {
            console.error('XXX broken for now.  Maybe move to view and use events.');
            //this.$('.f-presenter .f-call-member').removeClass('pinned');
            //const $el = $(ev.currentTarget);
            //$el.addClass('pinned');
            //this.selectPresenter($el);
        },

        onClickPresenter: function(ev) {
            $(ev.currentTarget).toggleClass('pinned');
        },

        onVideoMuteClick: function(ev) {
            const $btn = $(ev.currentTarget);
            const mute = $btn.hasClass('blue');
            $btn.toggleClass('blue red');
            for (const track of this.outView.stream.getVideoTracks()) {
                track.enabled = !mute;
            }
        },

        onAudioMuteClick: function(ev) {
            const $btn = $(ev.currentTarget);
            const mute = $btn.hasClass('blue');
            $btn.toggleClass('blue red');
            for (const track of this.outView.stream.getAudioTracks()) {
                track.enabled = !mute;
            }
        },

        onJoin: function() {
            this.$('.f-join-call.button').attr('disabled', 'disabled');
            this.$('.f-leave-call.button').removeAttr('disabled');
        },

        onLeave: function() {
            this.$('.f-join-call.button').removeAttr('disabled');
            this.$('.f-leave-call.button').attr('disabled', 'disabled');
        },

        remove: function() {
            debugger;
            this.stopMonitor();
            this.leave();
            for (const view of this.memberViews.values()) {
                view.remove();
            }
            this.memberViews.clear();
            return F.ModalView.prototype.remove.call(this);
        }
    });


    F.CallMemberView = F.View.extend({

        template: 'views/call-member.html',
        className: 'f-call-member-view',

        initialize: function(options) {
            this.onAddTrack = this._onAddTrack.bind(this);
            this.onRemoveTrack = this._onRemoveTrack.bind(this);
            this.onTrackStarted = this._onTrackStarted.bind(this);
            this.onTrackMute = this._onTrackMute.bind(this);
            this.onTrackUnmute = this._onTrackUnmute.bind(this);
            this.onTrackOverconstrained = this._onTrackOverconstrained.bind(this);
            this.onTrackEnded = this._onTrackEnded.bind(this);
            this.onPeerICEConnectionStateChange = this._onPeerICEConnectionStateChange.bind(this);
            this.onPeerConnectionStateChange = this._onPeerConnectionStateChange.bind(this);
            this.on('leave', this.onLeave.bind(this));
            this.userId = options.userId;
            this.order = options.order;
            this.soundLevel = 0;
            F.View.prototype.initialize(options);
        },

        startTrackListeners: function(track) {
            track.addEventListener('started', this.onTrackStarted);
            track.addEventListener('mute', this.onTrackMute);
            track.addEventListener('unmute', this.onTrackUnmute);
            track.addEventListener('overconstrained', this.onTrackOverconstrained);
            track.addEventListener('ended', this.onTrackEnded);
        },

        stopTrackListeners: function(track) {
            track.removeEventListener('started', this.onTrackStarted);
            track.removeEventListener('mute', this.onTrackMute);
            track.removeEventListener('unmute', this.onTrackUnmute);
            track.removeEventListener('overconstrained', this.onTrackOverconstrained);
            track.removeEventListener('ended', this.onTrackEnded);
        },

        render_attributes: async function() {
            const user = await F.atlas.getContact(this.userId);
            return {
                id: user.id,
                name: user.getName(),
                tagSlug: user.getTagSlug(),
                avatar: await user.getAvatar({
                    size: 'large',
                    allowMultiple: true
                }),
                isSelf: this.userId === F.currentUser.id
            };
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$el.css('order', this.order);
            return this;
        },

        bindStream: function(stream) {
            F.assert(stream instanceof MediaStream);
            this.unbindStream();
            stream.addEventListener('addtrack', this.onAddTrack);
            stream.addEventListener('removetrack', this.onRemoveTrack);
            for (const track of stream.getTracks()) {
                this.startTrackListeners(track);
            }
            this.soundMeter = new SoundMeter(stream, levels => this.soundLevel = levels.average);
            this.stream = stream;
            this.$('video')[0].srcObject = this.stream;
        },

        unbindStream: function() {
            if (this.soundMeter) {
                this.soundMeter.disconnect();
            }
            if (this.stream) {
                this.stream.removeEventListener('addtrack', this.onAddTrack);
                this.stream.removeEventListener('removetrack', this.onRemoveTrack);
                for (const track of this.stream.getTracks()) {
                    this.stopTrackListeners(track);
                }
            }
            this.stream = null;
            this.$('video')[0].srcObject = null;
        },

        bindPeer: function(peer) {
            F.assert(peer instanceof RTCPeerConnection);
            this.unbindPeer();
            this.peer = peer;
            peer.addEventListener('iceconnectionstatechange', this.onPeerICEConnectionStateChange);
            peer.addEventListener('connectionstatechange', this.onPeerConnectionStateChange);
        },

        unbindPeer: function() {
            if (this.peer) {
                this.peer.removeEventListener('iceconnectionstatechange', this.onPeerICEConnectionStateChange);
                this.peer.removeEventListener('connectionstatechange', this.onPeerConnectionStateChange);
                this.peer = null;
            }
        },

        onLeave: function() {
            this.unbindPeer();
            this.unbindStream();
        },

        _onAddTrack: function(ev) {
            // add eventlisteners and attach to view;  maybe rerender
            debugger;
        },

        _onRemoveTrack: function(ev) {
            // remove eventlisteners and unattach from view;  maybe rerender
            debugger;
        },

        _onTrackStarted: function(ev) {
            debugger;
        },

        _onTrackMute: function(ev) {
            debugger;
        },

        _onTrackUnmute: function(ev) {
            debugger;
        },

        _onTrackOverconstrained: function(ev) {
            debugger;
        },

        _onTrackEnded: function(ev) {
            debugger;
        },

        _onPeerICEConnectionStateChange: function(ev) {
            const state = ev.target.iceConnectionState;
            console.debug("Peer ICE connection state:", this.userId, state);
            this.$('.f-ice-connection-state').html(state);
        },

        _onPeerConnectionStateChange: function(ev) {
            const state = ev.target.connectionState;
            console.debug("Peer connection state:", this.userId, state);
            this.$('.f-connection-state').html(state);
        },

        remove: function() {
            debugger;
            this.unbindPeer();
            this.unbindStream();
            for (const track of Array.from(this.stream.getTracks())) {
                track.stop();
                this.stream.removeTrack(track);
            }
            return F.View.prototype.remove.call(this);
        }
    });


    class SoundMeter {
        // Adapted from: https://github.com/webrtc/samples/blob/gh-pages/src/content/getusermedia/volume/js/soundmeter.js

        constructor(stream, onLevel) {
            this.current = 0;  // public
            this.average = 0;  // public
            const AudioContext = self.AudioContext || self.webkitAudioContext;
            if (!AudioContext) {
                return;  // Unsupported
            }
            const audioCtx = new AudioContext();
            this.script = audioCtx.createScriptProcessor(2048, 1, 1);
            this.script.addEventListener('audioprocess', event => {
                const input = event.inputBuffer.getChannelData(0);
                let sum = 0;
                for (const x of input) {
                    sum += x ** 2;
                }
                this.current = Math.sqrt(sum / input.length);
                this.average = 0.95 * this.average + 0.05 * this.current;
                onLevel({
                    current: this.current,
                    average: this.average,
                });
            });
            this.src = audioCtx.createMediaStreamSource(stream);
            this.src.connect(this.script);
            // necessary to make sample run, but should not be.
            this.script.connect(audioCtx.destination);
        }

        disconnect() {
            if (this.src) {
                this.src.disconnect();
                this.src = null;
            }
            if (this.script) {
                this.script.disconnect();
                this.script = null;
            }
        }
    }
})();
