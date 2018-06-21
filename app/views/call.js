// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    F.CallView = F.ModalView.extend({

        template: 'views/call.html',
        className: 'f-call ui modal',

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
            console.assert(!this._rendered);
            // Skip modal render which we don't want.
            await F.View.prototype.render.call(this);
            if (!this.callId) {
                // We are the originator
                console.assert(!this.members);
                console.assert(!this.originator);
                this.members = await this.model.getMembers(/*excludePending*/ true);
                this.callId = F.util.uuid4();
                this.originator = F.currentUser.id;
                console.info("Starting new call:", this.callId);
            } else {
                console.assert(this.members);
                console.assert(this.originator);
            }
            console.assert(!this.outView);
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
            this.startMonitor();
            return this;
        },

        addMemberView: async function(userId) {
            console.assert(!this.memberViews.has(userId));
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
            console.assert(!this.sessions.size);
            console.assert(!this.pending.size);
            this._left = false;
            this.trigger('join');
            if (!this.outView) {
                await this.attachOutSession();
            }
            await Promise.all(this.members.filter(x => x !== F.currentUser.id).map(x => this.sendOffer(x)));
        },

        leave: function() {
            if (this._left) {
                return;
            }
            if (this.outView) {
                this.detachOutView();
            }
            for (const x of Array.from(this.sessions.keys())) {
                this.removeSession(x);
                this.sendControl('callLeave', x);
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
                console.assert(this.members.indexOf(userId) !== -1);
                const peer = await this.createPeerConnection(userId);
                const offer = await peer.createOffer();
                console.assert(!this.pending.has(userId));
                this.pending.set(userId, {peer, offer});
                console.info("Sending offer to:", userId);
                await this.sendControl('callOffer', userId, {offer});
            });
        },

        acceptOffer: async function(userId, offer) {
            this.trigger('join');
            await F.queueAsync(`call-accept-offer-${this.callId}-${userId}`, async () => {
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
                const peer = await this.createPeerConnection(userId);
                await peer.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await peer.createAnswer();
                await this.sendControl('callAcceptOffer', userId, {answer});
                await peer.setLocalDescription(answer);  // Triggers ICE events AFTER answer control is sent.
                if (!this.outSession) {
                    await this.attachOutSession();
                }
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

        attachOutSession: async function() {
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
            } catch(e) {
                this.setStatus('ERROR: ' + e.message);
                return;
            }
            console.assert(!this.$('.f-presenter').html().trim());
            console.assert(!this.outView);
            this.outSession = this.addSession({
                userId: F.currentUser.id,
                stream,
                order: -1
            });
            await this.outView.render();
            this.$('.f-presenter').append(this.outView.$el);
        },

        detachOutView: function() {
            console.assert(this.outView);
            this.outView.remove();
            this.outView = null;
        },

        startMonitor: async function() {
            if (!this._soundCheckInterval) {
                this._soundCheckInterval = setInterval(this.checkSoundLevels.bind(this), 200);
            }
            if (!this._sessionCheckRunning) {
                (async () => {
                    let backoff = 1;
                    this._sessionCheckRunning = true;
                    try {
                        while (this._sessionCheckRunning) {
                            for (const id of this.members) {
                                // We need jitter to prevent collisions.
                                await relay.util.sleep(Math.random() * backoff);
                                if (!this._sessionCheckRunning) {
                                    break;
                                }
                                if (id !== F.currentUser.id && !this.sessions.has(id) &&
                                    !this.pending.has(id) && !this.left.has(id)) {
                                    console.warn("Repairing session initiated send offer");
                                    await this.sendOffer(id);
                                }
                            }
                            backoff *= 1.25;
                        }
                    } finally {
                        this._sessionCheckRunning = false;
                    }
                })();
            }
        },

        stopMonitor: function() {
            clearInterval(this._soundCheckInterval);
            this._soundCheckInterval = null;
            this._sessionCheckRunning = false;
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
            for (const x of this.sessions.values()) {
                if (x.stream === stream) {
                    return x.peer;
                }
            }
        },

        removeSession: function(id) {
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
            console.assert(peer instanceof RTCPeerConnection);
            console.assert(stream instanceof MediaStream);
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

        createPeerConnection: async function(peerIdentity) {
            const iceServers = await F.atlas.getRTCServersFromCache();
            const peer = new RTCPeerConnection({iceServers});
            peer.addEventListener('icecandidate', async ev => {
                if (!ev.candidate) {
                    return;  // Drop the empty one we start with.
                }
                console.debug("Sending ICE candidate for", peerIdentity);
                await this.sendControl('callICECandidate', peerIdentity,
                                       {icecandidate: ev.candidate});
            });
            peer.addEventListener('track', ev => {
                for (const stream of ev.streams) {
                    if (this.getPeerByStream(stream)) {
                        console.debug("Ignoring known stream for:", peerIdentity);
                    } else {
                        console.info("Adding Media Stream for:", peerIdentity);
                        this.addSession(peerIdentity, peer, stream);
                    }
                }
            });
            peer.addEventListener('iceconnectionstatechange', ev => {
                const state = ev.target.iceConnectionState;
                console.debug("Peer ICE connection state:", peerIdentity, state);
                const session = this.sessions.get(peerIdentity);
                if (session) {
                    debugger;
                    session.view.attr('data-ice-connection-state', state);
                }
            });
            peer.addEventListener('connectionstatechange', ev => {
                const state = ev.target.connectionState;
                console.debug("Peer connection state:", peerIdentity, state);
                const session = this.sessions.get(peerIdentity);
                if (session) {
                    session.view.$el.attr('data-connection-state', state);
                }
            });
            peer.addEventListener('negotiationneeded', async ev => {
                // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/onnegotiationneeded
                debugger;
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

        onPeerAcceptOffer: async function(sender, data) {
            console.assert(data.callId === this.callId);
            const pending = this.pending.get(sender);
            if (!pending) {
                // Most likely we abandoned the peer because we started our own offer.
                // Need to make sure the other side didn't also do the same.
                console.error("Dropping offer answer for invalid peer:", sender);
                return;
            }
            this.pending.delete(sender);
            console.info("Peer accepted our call offer:", sender);
            await pending.peer.setLocalDescription(pending.offer);
            await pending.peer.setRemoteDescription(new RTCSessionDescription(data.answer));
        },

        onPeerICECandidate: async function(sender, data) {
            console.assert(data.callId === this.callId);
            let peer;
            if (this.sessions.has(sender)) {
                peer = this.sessions.get(sender).peer;
            } else {
                console.warn("Received ICE candidate for pending peer", sender);
                // Misbehaving client, but we'll let it slide..
                const pending = this.pending.get(sender);
                peer = pending && pending.peer;
            }
            if (!peer) {
                console.error("Dropping ICE candidate for peer connection we don't have:", data);
                return;
            }
            console.debug("Received ICE Candidate for:", sender);
            await peer.addIceCandidate(new RTCIceCandidate(data.icecandidate));
        },

        onPeerLeave: async function(sender, data) {
            console.warn('Peer left call:', sender);
            this.left.add(sender);
            this.removeSession(sender);
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
            this.leave();
            for (const view of this.memberViews.values()) {
                view.remove();
            }
            this.stopMonitor();
            return F.ModalView.prototype.remove.call(this);
        }

    });


    F.CallMemberView = F.View.extend({

        template: 'views/call-member.html',
        className: 'f-call-member',

        initialize: function(options) {
            this.onAddTrack = this._onAddTrack.bind(this);
            this.onRemoveTrack = this._onRemoveTrack.bind(this);
            this.onTrackStarted = this._onTrackStarted.bind(this);
            this.onTrackMute = this._onTrackMute.bind(this);
            this.onTrackUnmute = this._onTrackUnmute.bind(this);
            this.onTrackOverconstrained = this._onTrackOverconstrained.bind(this);
            this.onTrackEnded = this._onTrackEnded.bind(this);
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
            this.$('video')[0].srcObject = this.stream;
            return this;
        },

        bindStream: function(stream) {
            console.assert(stream instanceof MediaStream);
            this.unbindStream();
            stream.addEventListener('addtrack', this.onAddTrack);
            stream.addEventListener('removetrack', this.onRemoveTrack);
            for (const track of stream.getTracks()) {
                this.startTrackListeners(track);
            }
            this.stream = stream;
            this.soundMeter = new SoundMeter(stream, levels => this.soundLevel = levels.average);
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
        },

        bindPeer: function(peer) {
            console.assert(peer instanceof RTCPeerConnection);
            this.unbindPeer();
            this.peer = peer;
        },

        unbindPeer: function() {
            this.peer = null;
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

        remove: function() {
            debugger;
            this.$('video')[0].srcObject = null;
            for (const track of Array.from(this.stream.getTracks())) {
                track.stop();
                this.stream.removeTrack(track);
            }
            return F.View.prototype.remove.call(this);
        }
    });


    class SoundMeter {
        // Adapted from: https://github.com/webrtc/samples/blob/gh-pages/src/content/getusermedia/volume/js/soundmeter.js

        constructor(stream, onLevels) {
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
                onLevels({
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
