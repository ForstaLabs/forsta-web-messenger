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
            this.trigger('join');
        },

        leave: function() {
            if (!this.joined) {
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
                if (view.peer) {
                    throw new TypeError("Peer is already bound");
                }
                const peerIdentity = F.util.uuid4();
                const peer = await this.createPeerConnection(userId, peerIdentity);
                const offer = await peer.createOffer();
                peer._pendingOffer = offer;  // Save for later to avoid starting ICE.
                view.bindPeer(peer);
                console.info("Sending offer to:", userId);
                await this.sendControl('callOffer', userId, {offer, peerIdentity});
            });
        },

        acceptOffer: async function(userId, data) {
            await F.queueAsync(`call-accept-offer-${this.callId}-${userId}`, async () => {
                const view = this.memberViews.get(userId);
                if (view.peer) {
                    console.warn('Removing stale session for:', userId);
                    view.unbindPeer();
                }
                console.info("Accepting call offer from:", userId);
                const peer = await this.createPeerConnection(userId, data.peerIdentity);
                await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peer.createAnswer();
                view.bindPeer(peer);
                await this.sendControl('callAcceptOffer', userId, {
                    peerIdentity: data.peerIdentity,
                    answer
                });
                await peer.setLocalDescription(answer);  // Triggers ICE events AFTER answer control is sent.
            });
            this.trigger('join');
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
            this._soundCheckInterval = setInterval(this.checkSoundLevels.bind(this), 400);
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
                    if (!this.joined || /*XXX*/ true) {
                        continue;
                    }
                    backoff *= 1.25;
                    for (const view of this.membersViews.values()) {
                        if (view.userId !== F.currentUser.id && !view.peer && !view.left) {
                            console.warn("Repairing session initiated send offer");
                            await this.sendOffer(view.userId);
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
                this._presenter.$('video')[0].play().catch(e => 0);
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
            for (const track of this.outView.stream.getTracks()) {
                peer.addTrack(track, this.outView.stream);
            }
            return peer;
        },

        onPeerAcceptOffer: async function(userId, data) {
            F.assert(data.callId === this.callId);
            const view = this.memberViews.get(userId);
            const peer = view.peer;
            if (!peer || !peer._pendingOffer || peer._ident !== data.peerIdentity) {
                console.error("Dropping accept-offer for invalid peer:", userId);
                return;
            }
            console.info("Peer accepted our call offer:", userId);
            const ourOffer = peer._pendingOffer;
            delete peer._pendingOffer;
            await peer.setLocalDescription(ourOffer);
            await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
        },

        onPeerICECandidate: async function(userId, data) {
            F.assert(data.callId === this.callId);
            F.assert(data.peerIdentity);
            const view = this.memberViews.get(userId);
            const peer = view.peer;
            if (!peer || peer._ident !== data.peerIdentity) {
                console.error("Dropping ICE candidate for peer connection we don't have:", data);
                return;
            }
            console.debug("Adding ICE Candidate for:", userId);
            await peer.addIceCandidate(new RTCIceCandidate(data.icecandidate));
        },

        onPeerLeave: async function(userId, data) {
            console.warn('Peer left call:', userId);
            const view = this.memberViews.get(userId);
            view.trigger('leave');
        },

        onJoinClick: function() {
            this.join();
        },

        onLeaveClick: function() {
            this.leave();
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

        onJoin: async function() {
            this.$('.f-join-call.button').attr('disabled', 'disabled');
            this.$('.f-leave-call.button').removeAttr('disabled');
            this.joined = true;
            for (const view of this.memberViews.values()) {
                if (view.userId !== F.currentUser.id && !view.peer) {
                    await this.sendOffer(view.userId);
                }
            }
        },

        onLeave: function() {
            this.joined = false;
            this.$('.f-join-call.button').removeAttr('disabled');
            this.$('.f-leave-call.button').attr('disabled', 'disabled');
        },

        remove: function() {
            //this.stopMonitor();
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
            this.onPeerTrack = this._onPeerTrack.bind(this);
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

        setState: function(value) {
            const $el = this.$('.f-state');
            if (value) {
                $el.show().html(value);
            } else {
                $el.hide().html('');
            }
        },

        bindStream: function(stream) {
            F.assert(stream instanceof MediaStream);
            this.unbindStream();
            //stream.addEventListener('addtrack', this.onAddTrack);
            //stream.addEventListener('removetrack', this.onRemoveTrack);
            for (const track of stream.getTracks()) {
                this.startTrackListeners(track);
            }
            this.soundMeter = new SoundMeter(stream, levels => this.soundLevel = levels.average);
            this.stream = stream;
            this.$('.novideo').hide();
            this.$('video').show()[0].srcObject = this.stream;
        },

        unbindStream: function() {
            if (this.soundMeter) {
                this.soundMeter.disconnect();
            }
            if (this.stream) {
                //this.stream.removeEventListener('addtrack', this.onAddTrack);
                //this.stream.removeEventListener('removetrack', this.onRemoveTrack);
                for (const track of this.stream.getTracks()) {
                    this.stopTrackListeners(track);
                    //track.stop();
                    //this.stream.removeTrack(track);
                }
            }
            this.stream = null;
            this.$('video').hide()[0].srcObject = null;
            this.$('.novideo').show();
        },

        bindPeer: function(peer) {
            F.assert(peer instanceof RTCPeerConnection);
            this.setState();
            this.left = false;
            this.unbindPeer();
            this.peer = peer;
            peer.addEventListener('iceconnectionstatechange', this.onPeerICEConnectionStateChange);
            peer.addEventListener('connectionstatechange', this.onPeerConnectionStateChange);
            peer.addEventListener('track', this.onPeerTrack);
            const stream = new MediaStream();
            for (const sender of peer.getSenders()) {
                stream.addTrack(sender.track);
            }
        },

        unbindPeer: function() {
            if (this.peer) {
                this.peer.removeEventListener('iceconnectionstatechange', this.onPeerICEConnectionStateChange);
                this.peer.removeEventListener('connectionstatechange', this.onPeerConnectionStateChange);
                this.peer.close();
                this.peer = null;
            }
        },

        onLeave: function() {
            this.left = true;
            this.unbindPeer();
            this.unbindStream();
            this.setState("Left Call");
        },

        _onAddTrack: function(ev) {
            // add eventlisteners and attach to view;  maybe rerender
            debugger;
        },

        _onRemoveTrack: function(ev) {
            // remove eventlisteners and unattach from view;  maybe rerender
            debugger;
            this.stopTrackListeners(ev.track);
        },

        _onTrackStarted: function(ev) {
            debugger;
        },

        _onTrackMute: function(ev) {
            // XXX strangely spurious
            console.warn("TRACK MUTE");
        },

        _onTrackUnmute: function(ev) {
            // XXX strangely spurious
            console.warn("TRACK UNMUTE");
        },

        _onTrackOverconstrained: function(ev) {
            debugger;
        },

        _onTrackEnded: function(ev) {
            console.warn("TRACK ENDED");
            // XXX Now what?
        },

        _onPeerICEConnectionStateChange: function(ev) {
            const state = ev.target.iceConnectionState;
            this.setState(state);
        },

        _onPeerConnectionStateChange: function(ev) {
            const state = ev.target.connectionState;
            this.setState(state);
        },

        _onPeerTrack: function(ev) {
            F.assert(ev.streams.length === 1);
            const stream = ev.streams[0];
            if (stream != this.stream) {
                this.bindStream(stream);
            }
        },

        remove: function() {
            this.unbindPeer();
            this.unbindStream();
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
