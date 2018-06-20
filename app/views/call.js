// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.CallView = F.ModalView.extend({
        /* XXX May need to make most of these methods serialized. */

        template: 'views/call.html',
        className: 'f-call ui modal',

        initialize: function(options) {
            this.sessions = new Map();
            this.pendingPeers = new Map();
            this.callId = options.callId;
            this.originator = options.originator;
            this.members = options.members;
            this.on('icecandidate', this.onICECandidate);
            this.on('answer', this.onAnswer);
            F.ModalView.prototype.initialize(options);
        },

        events: {
            'click .f-join-call.button': 'joinCall',
            'click .f-end-call.button': 'endCall'
        },

        render_attributes: function() {
            return {
                thread: this.model
            };
        },

        render: async function() {
            // Skip modal render which we don't want.
            await F.View.prototype.render.call(this);
            if (!this.outStream) {
                await this.attachOutStream();
            }
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
            return this;
        },

        OLDrender: async function() {
            if (this.offer) {
                const offer = this.offer;
                this.offer = undefined;
                await this.acceptOffer(offer);
                /* This is a very important trick to avoid sending offers to clients that intend
                 * to send offers to us.  The rule is that if our ID is lexicographically greater-than
                 * theirs, then we are the initiator, otherwise we expect a response from them. */
                const otherUsers = this.members.filter(x => x < F.currentUser.id && x !== offer.identity);
                await Promise.all(otherUsers.map(x => this.sendOffer(x)));
            } else {
                await this.joinCall();
            }
            return this;
        },

        setStatus: function(value) {
            this.$('.f-call-status').text(value);
        },

        joinCall: async function() {
            console.assert(!this.sessions.size);
            console.assert(!this.pendingPeers.size);
            this.$('.f-join-call.button').attr('disabled', 'disabled');
            this.$('.f-end-call.button').removeAttr('disabled');
            if (!this.outStream) {
                await this.attachOutStream();
            }
            await Promise.all(this.members.filter(x => x !== F.currentUser.id).map(x => this.sendOffer(x)));
        },

        endCall: function() {
            if (this.outStream) {
                this.detachOutStream();
            }
            for (const x of Array.from(this.sessions.keys())) {
                this.removeSession(x);
            }
            for (const x of this.pendingPeers.values()) {
                x.close();
            }
            this.pendingPeers.clear();
            this.$('.f-join-call.button').removeAttr('disabled');
            this.$('.f-end-call.button').attr('disabled', 'disabled');
        },

        sendOffer: async function(userId) {
            console.assert(this.members.indexOf(userId) !== -1);
            const peer = await this.createPeerConnection(userId);
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            console.assert(!this.pendingPeers.has(userId));
            this.pendingPeers.set(userId, peer);
            console.info("Sending offer to:", userId);
            await this.model.sendControl({
                control: 'callOffer',
                offer,
                members: this.members,
                callId: this.callId,
                originator: this.originator
            }, null, {addrs: [userId]});
        },

        acceptOffer: async function(userId, offer) {
            if (!this.outStream) {
                await this.attachOutStream();
            }
            if (this.sessions.has(userId)) {
                console.warn('Resetting stale session for:', userId);
                this.removeSession(userId);
            }
            console.info("Accepting offer from:", userId);
            this.$('.f-join-call.button').attr('disabled', 'disabled');
            this.$('.f-end-call.button').removeAttr('disabled');
            const peer = await this.createPeerConnection(userId);
            await peer.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await this.model.sendControl({
                control: 'callAnswer',
                answer,
                callId: this.callId,
            }, null, {addrs: [userId]});
        },

        attachOutStream: async function(screen) {
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
            } catch(e) {
                this.setStatus('ERROR: ' + e.message);
                return;
            }
            this.$('.f-video.local video')[0].srcObject = stream;
            console.assert(!this.outStream);
            this.outStream = stream;
            console.assert(!this._soundInterval);
            this._soundInterval = setInterval(this.checkSoundLevels.bind(this), 200);
        },

        detachOutStream: function() {
            console.assert(this.outStream);
            const stream = this.outStream;
            this.outStream = null;
            clearInterval(this._soundInterval);
            this._soundInterval = null;
            this.$('.f-video.local video')[0].srcObject = null;
            for (const track of stream.getTracks()) {
                track.stop();
            }
        },

        checkSoundLevels: function() {
            let loudest;
            for (const session of this.sessions.values()) {
                if (!loudest || session.soundMeter.average > loudest.soundMeter.average) {
                    loudest = session;
                }
            }
            if (loudest && this._lastLoudest !== loudest && loudest.el.parent('.f-audience').length) {
                this._lastLoudest = loudest;
                console.warn("Swap in new presenter:", loudest);
                const $current = this.$('.f-presenter .f-video');
                this.$('.f-audience')[0].appendChild($current[0]);
                this.$('.f-presenter')[0].appendChild(loudest.el[0]);
                // Fix browser bugs when moving video tags.
                $current.find('video')[0].play();
                loudest.el.find('video')[0].play();
            }
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
            session.el.remove();
            session.el.find('video')[0].srcObject = null;
            session.soundMeter.disconnect();
        },

        addSession: async function(id, peer, stream) {
            console.assert(peer instanceof RTCPeerConnection);
            console.assert(stream instanceof MediaStream);
            if (this.sessions.has(id)) {
                throw new Error("Already added");
            }
            const user = await F.atlas.getContact(id);
            const $videoBox = $(`<div class="f-video remote" data-whois="${user.getName()}">` +
                                `<video autoplay/></video></div>`);
            $videoBox.find('video')[0].srcObject = stream;
            this.$('.f-audience').append($videoBox);
            const soundMeter = new SoundMeter(stream);
            const entry = {
                id,
                el: $videoBox,
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
                await this.model.sendControl({
                    control: 'callICECandidate',
                    icecandidate: ev.candidate,
                    callId: this.callId,
                }, null, {addrs: [peerIdentity]});
            });
            peer.addEventListener('track', async ev => {
                for (const stream of ev.streams) {
                    if (this.getPeerByStream(stream)) {
                        console.debug("Ignoring known stream:", peerIdentity, stream);
                    } else {
                        console.info("Adding Media Stream from peer connection:", peerIdentity, stream.id);
                        await this.addSession(peerIdentity, peer, stream);
                    }
                }
            });
            peer.addEventListener('iceconnectionstatechange', ev => {
                const state = ev.target.iceConnectionState;
                console.info("Peer ICE connection state:", peerIdentity, state, this.sessions.has(peerIdentity));
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
            this.endCall();
            F.ModalView.prototype.onHide.apply(this, arguments);
        },

        onAnswer: async function(sender, data) {
            console.assert(data.callId === this.callId);
            const peer = this.pendingPeers.get(sender);
            if (!peer) {
                throw new ReferenceError("Pending peer not found for offer answer");
            }
            this.pendingPeers.delete(sender);
            await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
        },

        onICECandidate: async function(sender, data) {
            console.assert(data.callId === this.callId);
            let peer;
            if (this.sessions.has(sender)) {
                peer = this.sessions.get(sender).peer;
            } else {
                peer = this.pendingPeers.get(sender);
                if (peer) {
                    console.error("XXX unexpected");
                    debugger;
                }
            }
            if (!peer) {
                console.warn("Dropping ICE candidate for peer connection we don't have:", data);
                return;
            }
            await peer.addIceCandidate(new RTCIceCandidate(data.icecandidate));
        }
    });


    class SoundMeter {
        // Adapted from: https://github.com/webrtc/samples/blob/gh-pages/src/content/getusermedia/volume/js/soundmeter.js

        constructor(stream) {
            const audioCtx = new AudioContext();
            this.current = 0;  // public
            this.average = 0;  // public
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
            this.src.disconnect();
            this.script.disconnect();
            this.src = null;
            this.script = null;
        }
    }
})();
