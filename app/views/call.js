// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    F.CallView = F.ModalView.extend({

        template: 'views/call.html',
        className: 'f-call-view ui modal',

        initialize: function(options) {
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
            'click .f-join-call.button': 'onJoinClick',
            'click .f-leave-call.button': 'onLeaveClick',
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
            let outStream;
            try {
                outStream = await this.getOutStream();
            } catch(e) {
                console.error("Could not get camera/audio stream:", e);
                this.setCallStatus('<i class="icon red warning sign"></i> ' +
                                   'Video or audio device not available.');
            }
            if (outStream) {
                this.outView.bindStream(outStream);
            } else {
                this.outView.bindStream(new MediaStream());
            }
            this.selectPresenter(this.outView);
            this._soundCheckInterval = setInterval(this.checkSoundLevels.bind(this), 500);
            return this;
        },

        addMemberView: async function(userId) {
            F.assert(!this.memberViews.has(userId));
            const order = this.members.indexOf(userId);
            const view = new F.CallMemberView({userId, order});
            view.on('pinned', this.onViewPinned.bind(this));
            view.on('restart', this.onViewRestart.bind(this));
            await view.render();
            this.memberViews.set(userId, view);
            this.$('.f-audience').append(view.$el);
            return view;
        },

        setCallStatus: function(value) {
            this.$('.f-call-status').html(value);
        },

        join: function() {
            this.trigger('join');
            F.util.playAudio('/audio/phone-dial.mp3');
        },

        leave: function() {
            if (!this.isJoined()) {
                return;
            }
            for (const view of this.memberViews.values()) {
                if (view === this.outView) {
                    continue;
                }
                view.trigger('leave');
                this.sendControl('callLeave', view.userId);
            }
            this.trigger('leave');
        },

        remove: function() {
            clearInterval(this._soundCheckInterval);
            this._soundCheckInterval = null;
            this.leave();
            for (const view of this.memberViews.values()) {
                view.remove();
            }
            this.memberViews.clear();
            return F.ModalView.prototype.remove.call(this);
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
                const view = this.memberViews.get(userId);
                view.setStatus();
                let peer;
                if (view.peer) {
                    console.warn("Peer is already bound:", userId);
                    peer = view.peer;
                } else {
                    peer = await this.bindPeerConnection(view, F.util.uuid4());
                }
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                console.info("Sending offer to:", userId);
                view.setStatus('Calling');
                const called = view.statusChanged;
                await this.sendControl('callOffer', userId, {
                    offer: peer.localDescription,
                    peerId: peer._id
                });
                relay.util.sleep(15).then(() => {
                    if (view.statusChanged === called) {
                        view.setStatus('Unavailable');
                    }
                });
            });
        },

        acceptOffer: async function(userId, data) {
            await F.queueAsync(`call-accept-offer-${this.callId}-${userId}`, async () => {
                const view = this.memberViews.get(userId);
                if (view.peer) {
                    console.warn('Removing stale peer for:', userId);
                    view.unbindPeer();
                }
                console.info("Accepting call offer from:", userId);
                const peer = await this.bindPeerConnection(view, data.peerId);
                await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
                F.assert(peer.remoteDescription.type === 'offer');
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                await this.sendControl('callAcceptOffer', userId, {
                    peerId: data.peerId,
                    answer: peer.localDescription
                });
            });
            this.trigger('join');
        },

        getOutStream: async function() {
            return await navigator.mediaDevices.getUserMedia({audio: true, video: true});
        },

        checkSoundLevels: function() {
            if (this._presenter && this._presenter.isPinned()) {
                return;
            }
            let loudest = this.outView;
            for (const view of this.memberViews.values()) {
                if (view.soundLevel > loudest.soundLevel) {
                    loudest = view;
                }
            }
            if (this._presenter !== loudest) {
                // Only switch it's truly loud.  Perhaps this should be dynamic to avoid
                // thrashing.
                if (loudest.soundLevel > 1.5) {
                    this.selectPresenter(loudest);
                }
            }
        },

        selectPresenter: function(view) {
            if (this._presenter === view) {
                return;
            }
            if (this._presenter) {
                this._presenter.$el.detach().appendTo(this.$('.f-audience'));
                // XXX Workaround chrome bug that stops playback.. (try to detect in callmember view via pause ev
                this._presenter.$('video')[0].play().catch(e => 0);
            }
            view.$el.detach().appendTo(this.$('.f-presenter'));
            // Workaround chrome bug that stops playback..
            view.$('video')[0].play().catch(e => 0);
            this._presenter = view;
        },

        bindPeerConnection: async function(view, peerId) {
            const iceServers = await F.atlas.getRTCServersFromCache();
            const peer = new RTCPeerConnection({iceServers});
            const userId = view.userId;
            peer._id = peerId;  // Not to be confused with the peerIdentity spec prop.
            view.bindPeer(peer);
            peer.addEventListener('icecandidate', async ev => {
                if (!ev.candidate) {
                    return;  // Drop the empty one we start with.
                }
                console.debug("Sending ICE candidate for", userId);
                await this.sendControl('callICECandidate', userId, {
                    icecandidate: ev.candidate,
                    peerId,
                });
            });
            peer.addEventListener('track', ev => {
                // Firefox will sometimes have more than one media stream but they
                // appear to always be the same stream. Strange.
                if (view.peer !== peer) {
                    console.error("Dropping stale peer event:", ev);
                    return;
                }
                const stream = ev.streams[0];
                if (stream !== view.stream) {
                    console.info("Adding Media Stream for:", userId);
                    view.bindStream(stream);
                }
            });
            if (this.outView.stream) {
                for (const track of this.outView.stream.getTracks()) {
                    peer.addTrack(track, this.outView.stream);
                }
            }
            return peer;
        },

        isJoined: function() {
            return this.$el.hasClass('joined');
        },

        onPeerAcceptOffer: async function(userId, data) {
            F.assert(data.callId === this.callId);
            const view = this.memberViews.get(userId);
            const peer = view.peer;
            if (!peer || peer._id !== data.peerId) {
                console.error("Dropping accept-offer for invalid peer:", userId);
                return;
            }
            console.info("Peer accepted our call offer:", userId);
            await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
        },

        onPeerICECandidate: async function(userId, data) {
            F.assert(data.callId === this.callId);
            F.assert(data.peerId);
            const view = this.memberViews.get(userId);
            const peer = view.peer;
            if (!peer || peer._id !== data.peerId) {
                console.error("Dropping ICE candidate for peer connection we don't have:", data);
                return;
            }
            console.debug("Adding ICE Candidate for:", userId);
            await peer.addIceCandidate(new RTCIceCandidate(data.icecandidate));
        },

        onPeerLeave: async function(userId, data) {
            console.warn('Peer left call:', userId);
            const view = this.memberViews.get(userId);
            view.trigger('leave', 'Left');
        },

        onJoinClick: function() {
            this.join();
        },

        onLeaveClick: function() {
            this.leave();
        },

        onVideoMuteClick: function(ev) {
            if (!this.outView.stream) {
                console.warn("No outgoing stream to mute");
            }
            const $btn = $(ev.currentTarget);
            const mute = $btn.hasClass('blue');
            $btn.toggleClass('blue red');
            for (const track of this.outView.stream.getVideoTracks()) {
                track.enabled = !mute;
            }
        },

        onAudioMuteClick: function(ev) {
            if (!this.outView.stream) {
                console.warn("No outgoing stream to mute");
            }
            const $btn = $(ev.currentTarget);
            const mute = $btn.hasClass('blue');
            $btn.toggleClass('blue red');
            for (const track of this.outView.stream.getAudioTracks()) {
                track.enabled = !mute;
            }
        },

        onJoin: async function() {
            this.$('.f-join-call.button').attr('disabled', 'disabled');
            this.$('.f-leave-call.button').removeAttr('disabled');
            this.$el.addClass('joined');
            for (const view of this.memberViews.values()) {
                if (view.userId !== F.currentUser.id && !view.peer) {
                    await this.sendOffer(view.userId);
                }
            }
        },

        onLeave: function(state) {
            this.$el.removeClass('joined');
            this.$('.f-join-call.button').removeAttr('disabled');
            this.$('.f-leave-call.button').attr('disabled', 'disabled');
        },

        onViewPinned: function(view, pinned) {
            if (pinned) {
                for (const x of this.memberViews.values()) {
                    if (x !== view) {
                        x.trigger('pinned', x, false);
                    }
                }
            }
            this.selectPresenter(view);
        },

        onViewRestart: async function(view) {
            view.unbindStream();
            view.unbindPeer();
            await this.sendOffer(view.userId);
        }
    });


    F.CallMemberView = F.View.extend({

        template: 'views/call-member.html',
        className: 'f-call-member-view',

        events: {
            'click .f-pin': 'onPinClick',
            'click .f-restart': 'onRestartClick',
            'click .f-mute': 'onMuteClick',
        },

        initialize: function(options) {
            this.onAddTrack = this._onAddTrack.bind(this);
            this.onRemoveTrack = this._onRemoveTrack.bind(this);
            this.onTrackStarted = this._onTrackStarted.bind(this);
            this.onTrackOverconstrained = this._onTrackOverconstrained.bind(this);
            this.onTrackEnded = this._onTrackEnded.bind(this);
            this.onPeerICEConnectionStateChange = this._onPeerICEConnectionStateChange.bind(this);
            this.on('leave', this.onLeave.bind(this));
            this.on('pinned', this.onPinned.bind(this));
            this.userId = options.userId;
            this.order = options.order;
            this.soundLevel = -1;
            this.outgoing = this.userId === F.currentUser.id;
            F.View.prototype.initialize(options);
        },

        startTrackListeners: function(track) {
            track.addEventListener('started', this.onTrackStarted);
            track.addEventListener('overconstrained', this.onTrackOverconstrained);
            track.addEventListener('ended', this.onTrackEnded);
        },

        stopTrackListeners: function(track) {
            track.removeEventListener('started', this.onTrackStarted);
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
                outgoing: this.outgoing
            };
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$el.css('order', this.order);
            if (this.userId === F.currentUser.id) {
                this.$el.addClass('outgoing');
            }
            return this;
        },

        remove: function() {
            this.unbindStream();
            this.unbindPeer();
            return F.View.prototype.remove.call(this);
        },

        setStatus: function(value) {
            this.$('.f-status').text(value || '');
            this.statusChanged = Date.now();
        },

        getStatus: function() {
            return this.$('.f-status').text();
        },

        bindStream: function(stream) {
            F.assert(stream instanceof MediaStream);
            this.unbindStream();
            this.stream = stream;
            stream.addEventListener('addtrack', this.onAddTrack);
            stream.addEventListener('removetrack', this.onRemoveTrack);
            const muted = this.isMuted();
            const hasAudio = !!stream.getAudioTracks().length;
            const hasVideo = !!stream.getVideoTracks().length;
            const hasMedia = hasAudio || hasVideo;
            for (const track of stream.getTracks()) {
                this.startTrackListeners(track);
                if (track.kind === 'audio' && muted) {
                    track.enabled = false;
                }
            }
            if (hasAudio) {
                this.soundMeter = new SoundMeter(stream, levels => {
                    // The disconnect is not immediate, so we need to check our status.
                    if (this.soundMeter) {
                        this.soundLevel = levels.average * 100;
                    }
                });
            }
            if (hasVideo) {
                this.$('video')[0].srcObject = this.stream;
            }
            let streaming = false;
            if (this.outgoing) {
                streaming = hasMedia;
            } else if (this.peer) {
                const state = this.peer.iceConnectionState;
                streaming = hasMedia && (state === 'connected' || state === 'completed');
            }
            this.$el.toggleClass('streaming', !!streaming);
        },

        unbindStream: function() {
            this.$el.removeClass('streaming');
            if (this.soundMeter) {
                this.soundMeter.disconnect();
                this.soundMeter = null;
                this.soundLevel = -1;
            }
            if (this.stream) {
                this.stream.removeEventListener('addtrack', this.onAddTrack);
                this.stream.removeEventListener('removetrack', this.onRemoveTrack);
                for (const track of this.stream.getTracks()) {
                    this.stopTrackListeners(track);
                    track.stop();
                }
            }
            this.stream = null;
            this.$('video')[0].srcObject = null;
        },

        bindPeer: function(peer) {
            F.assert(peer instanceof RTCPeerConnection);
            this.left = false;
            this.unbindPeer();
            this.peer = peer;
            // NOTE: eventually we should switch to connectionstatechange when browser
            // support becomes available.  Right now chrome doesn't have it, maybe others.
            // Also don't trust MDN on this, they wrongly claim it is supported since M56.
            peer.addEventListener('iceconnectionstatechange', this.onPeerICEConnectionStateChange);
        },

        unbindPeer: function() {
            if (this.peer) {
                this.peer.removeEventListener('iceconnectionstatechange', this.onPeerICEConnectionStateChange);
                this.peer.close();
                this.peer = null;
            }
        },

        isStreaming: function() {
            return this.$el.hasClass('streaming');
        },

        isPinned: function() {
            return this.$el.hasClass('pinned');
        },

        isMuted: function() {
            return this.$('.f-mute.ui.button').hasClass('red');
        },

        onLeave: function(status) {
            this.left = true;
            this.unbindStream();
            this.unbindPeer();
            this.setStatus(status);
        },

        _onAddTrack: function(ev) {
            // Our current lifecycle probably doesn't need these.
            console.warn("TRACK ADDED UNEXPECTED");
            debugger;
        },

        _onRemoveTrack: function(ev) {
            // Our current lifecycle probably doesn't need these.
            console.warn("TRACK REMOVED UNEXPECTED");
            debugger;
        },

        _onTrackStarted: function(ev) {
            // Our current lifecycle probably doesn't need these.
            console.warn("TRACK STARTED");
        },

        _onTrackOverconstrained: function(ev) {
            console.warn("TRACK Overconstrained");
            debugger;
        },

        _onTrackEnded: function(ev) {
            // Our current lifecycle probably doesn't need these.
            console.warn("TRACK ENDED");
        },

        _onPeerICEConnectionStateChange: function(ev) {
            const state = ev.target.iceConnectionState;
            try {
                console.debug(`Peer ICE connection: ${this._lastState} -> ${state}`, this.userId);
                const hasMedia = !!(this.stream && this.stream.getTracks().length);
                const streaming = hasMedia && (state === 'connected' || state === 'completed');
                this.$el.toggleClass('streaming', !!streaming);
                if ((state === 'completed' && this._lastState === 'connected') ||
                    (state === 'failed' && this._lastState === 'disconnected')) {
                    return;
                }
                this.setStatus(state);
            } finally {
                this._lastState = state;
            }
        },

        onPinClick: function(ev) {
            this.trigger('pinned', this, !this.isPinned());
        },

        onRestartClick: function(ev) {
            this.trigger('restart', this);
        },

        onMuteClick: function(ev) {
            const mute = !this.isMuted();
            const $button = this.$('.f-mute.ui.button');
            $button.toggleClass('red');
            for (const track of this.stream.getAudioTracks()) {
                track.enabled = !mute;
            }
        },

        onPinned: function(view, pinned) {
            this.$el.toggleClass('pinned', !!pinned);
            const $button = this.$('.f-pin.ui.button');
            $button.toggleClass('red', !!pinned);
            if (pinned) {
                $button.attr('title', 'This video is pinned as the presenter');
            } else {
                $button.attr('title', 'Click to pin this video as presenter.');
            }
        }
    });


    class SoundMeter {
        // Adapted from: https://github.com/webrtc/samples/blob/gh-pages/src/content/getusermedia/volume/js/soundmeter.js


        static getAudioContext() {
            if (this._audioCtx === undefined) {
                const _AudioCtx = self.AudioContext || self.webkitAudioContext;
                this._audioCtx = _AudioCtx ? new _AudioCtx() : null;
                if (!this._audioCtx) {
                    console.warn("Audio not supported");
                }
            }
            return this._audioCtx;
        }

        constructor(stream, onLevel) {
            this.current = 0;  // public
            this.average = 0;  // public
            const ctx = this.constructor.getAudioContext();
            if (!ctx) {
                return;
            }
            this.script = ctx.createScriptProcessor(2048, 1, 1);
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
            this.src = ctx.createMediaStreamSource(stream);
            this.src.connect(this.script);
            // necessary to make sample run, but should not be.
            this.script.connect(ctx.destination);
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
