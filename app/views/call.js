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
            this.left = new Set();
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
            'click .f-audience .f-member': 'onClickAudience',
            'click .f-presenter .f-member': 'onClickPresenter',
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
            // Skip modal render which we don't want.
            await F.View.prototype.render.call(this);
            this._presenter = this.$('.f-presenter .f-member');
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
            if (!this.outStream) {
                await this.attachOutStream();
            }
            return this;
        },

        setStatus: function(value) {
            this.$('.f-call-status').text(value);
        },

        join: async function() {
            console.assert(!this.sessions.size);
            console.assert(!this.pending.size);
            this.trigger('join');
            if (!this.outStream) {
                await this.attachOutStream();
            }
            await Promise.all(this.members.filter(x => x !== F.currentUser.id).map(x => this.sendOffer(x)));
            this.startMonitor();
        },

        leave: function() {
            this.stopMonitor();
            if (this.outStream) {
                this.detachOutStream();
            }
            for (const x of Array.from(this.sessions.keys())) {
                this.removeSession(x);
            }
            for (const x of this.pending.values()) {
                x.peer.close();
            }
            this.pending.clear();
            this.trigger('leave');
        },

        sendOffer: async function(userId) {
            await F.queueAsync(`call-send-offer-${this.callId}`, async () => {
                console.assert(this.members.indexOf(userId) !== -1);
                const peer = await this.createPeerConnection(userId);
                const offer = await peer.createOffer();
                console.assert(!this.pending.has(userId));
                this.pending.set(userId, {peer, offer});
                console.info("Sending offer to:", userId);
                await this.model.sendControl({
                    control: 'callOffer',
                    offer,
                    members: this.members,
                    callId: this.callId,
                    originator: this.originator
                }, null, {addrs: [userId]});
            });
        },

        acceptOffer: async function(userId, offer) {
            this.trigger('join');
            await F.queueAsync(`call-accept-offer-${this.callId}`, async () => {
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
                await this.model.sendControl({
                    control: 'callAcceptOffer',
                    answer,
                    callId: this.callId,
                }, null, {addrs: [userId]});
                await peer.setLocalDescription(answer);  // Triggers ICE events AFTER answer control is sent.
                if (!this.outStream) {
                    await this.attachOutStream();
                }
                this.startMonitor();
            });
        },

        attachOutStream: async function(screen) {
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
            } catch(e) {
                this.setStatus('ERROR: ' + e.message);
                return;
            }
            this.$('.f-member.local video')[0].srcObject = stream;
            console.assert(!this.outStream);
            this.outStream = stream;
        },

        detachOutStream: function() {
            console.assert(this.outStream);
            const stream = this.outStream;
            this.outStream = null;
            this.$('.f-member.local video')[0].srcObject = null;
            for (const track of stream.getTracks()) {
                track.stop();
            }
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
            let loudest;
            for (const session of this.sessions.values()) {
                if (!loudest || session.soundMeter.average > loudest.soundMeter.average) {
                    loudest = session;
                }
            }
            if (loudest && (!this._presenter || !this._presenter.hasClass('pinned'))) {
                this.selectPresenter(loudest.el);
            }
        },

        selectPresenter: function($el) {
            if (this._presenter && $el.is(this._presenter)) {
                return;
            }
            if (this._presenter) {
                this._presenter.detach().appendTo(this.$('.f-audience'));
                // Workaround chrome bug that stops playback..
                this._presenter.find('video')[0].play().catch(e => 0);
            }
            $el.detach().appendTo(this.$('.f-presenter'));
            // Workaround chrome bug that stops playback..
            $el.find('video')[0].play().catch(e => 0);
            this._presenter = $el;
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
            if (session.el.is(this._presenter)) {
                this._presenter = null;
            }
            session.el.remove();
            session.el.find('video')[0].srcObject = null;
            session.soundMeter.disconnect();
        },

        addSession: function(id, peer, stream) {
            console.assert(peer instanceof RTCPeerConnection);
            console.assert(stream instanceof MediaStream);
            if (this.sessions.has(id)) {
                throw new Error("Already added");
            }
            const $el = $(`<div class="f-member remote"><video autoplay/></video></div>`);
            F.atlas.getContact(id).then(user => {
                // Use old school promises so addSession can remain synchronous.
                $el.attr('data-whois', user.getTagSlug());
            });
            $el.find('video')[0].srcObject = stream;
            this.$('.f-audience').append($el);
            const soundMeter = new SoundMeter(stream);
            const entry = {
                id,
                el: $el,
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
                await this.model.sendControl({
                    control: 'callICECandidate',
                    icecandidate: ev.candidate,
                    callId: this.callId,
                }, null, {addrs: [peerIdentity]});
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
                    session.el.attr('data-connection-state', state);
                }
            });
            for (const track of this.outStream.getTracks()) {
                peer.addTrack(track, this.outStream);
            }
            return peer;
        },

        onHide: function() {
            this.leave();
            F.ModalView.prototype.onHide.apply(this, arguments);
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
            console.info('Peer left call:', sender);
            this.left.add(sender);
            this.removeSession(sender);
        },

        onClickAudience: function(ev) {
            this.$('.f-presenter .f-member').removeClass('pinned');
            const $el = $(ev.currentTarget);
            $el.addClass('pinned');
            this.selectPresenter($el);
        },

        onClickPresenter: function(ev) {
            $(ev.currentTarget).toggleClass('pinned');
        },

        onVideoMuteClick: function(ev) {
            const $btn = $(ev.currentTarget);
            const mute = $btn.hasClass('blue');
            $btn.toggleClass('blue red');
            for (const track of this.outStream.getVideoTracks()) {
                track.enabled = !mute;
            }
        },

        onAudioMuteClick: function(ev) {
            const $btn = $(ev.currentTarget);
            const mute = $btn.hasClass('blue');
            $btn.toggleClass('blue red');
            for (const track of this.outStream.getAudioTracks()) {
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
        }
    });


    class SoundMeter {
        // Adapted from: https://github.com/webrtc/samples/blob/gh-pages/src/content/getusermedia/volume/js/soundmeter.js

        constructor(stream) {
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
