// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.CallView = F.ModalView.extend({
        template: 'views/call.html',
        className: 'f-call ui modal',

        initialize: function(options) {
            this.peers = new Map();
            this.xxxPeerAnswers = {};
            this.inStreams = new Map();
            this.offer = options.offer;
            this.on('icecandidate', this.onICECandidate);
            this.on('answer', this.onAnswer);
            F.ModalView.prototype.initialize(options);
        },

        events: {
            'click .f-join-call.button': 'joinCall',
            'click .f-end-call.button': 'endCall',
            'click .f-retry.button': 'render',
        },

        render_attributes: function() {
            return {
                thread: this.model,
                error: this.error
            };
        },

        render: async function() {
            this.error = undefined;
            try {
                this.outStream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
            } catch(e) {
                this.error = e.message;
            }
            await F.View.prototype.render.call(this);
            if (!this.error) {
                this.$('.f-video.local')[0].srcObject = this.outStream;
            }
            if (this.offer) {
                const offer = this.offer;
                this.offer = undefined;
                await this.acceptOffer(offer);
                const users = await this.model.getMembers(/*excludePending*/ true);
                /* This is a very important trick to avoid sending offers to clients that intend
                 * to send offers to us.  The rule is that if our ID is lexicographically greater-than
                 * theirs, then we are the initiator, otherwise we expect a response from them. */
                const otherUsers = users.filter(x => x < F.currentUser.id && x !== offer.identity);
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
            this.$('.f-join-call.button').attr('disabled', 'disabled');
            this.$('.f-end-call.button').removeAttr('disabled');
            console.assert(!this.peers.length);
            const users = await this.model.getMembers(/*excludePending*/ true);
            await Promise.all(users.filter(x => x !== F.currentUser.id).map(x => this.sendOffer(x)));
        },

        endCall: function() {
            const peers = new Map(this.peers);
            this.peers.clear();
            for (const peer of peers.values()) {
                peer.close();
            }
            if (this.outStream) {
                for (const track of this.outStream.getTracks()) {
                    track.stop();
                }
                this.outStream = null;
            }
            for (const x of this.inStreams.values()) {
                for (const track of x.stream.getTracks()) {
                    track.stop();
                }
            }
            this.inStreams.clear();
            this.$('.f-join-call.button').removeAttr('disabled');
            this.$('.f-end-call.button').attr('disabled', 'disabled');
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
                    icecandidate: ev.candidate
                }, null, {addrs: [peerIdentity]});
            });
            peer.addEventListener('track', ev => {
                const track = ev.track;
                console.info("Track event DET:", 'enabled=', track.enabled, track.kind, 'muted=', track.muted, track.readyState);
                for (const stream of ev.streams) {
                    if (this.inStreams.has(stream.id)) {
                        console.warn("Ignoring known stream!!!", stream);
                    } else {
                        console.info("Adding Media Stream:", stream);
                        const video = $('<video class="f-video remote" autoplay/></video>')[0];
                        video.srcObject = stream;
                        this.$('.f-videos').append(video);
                        this.inStreams.set(stream.id, {
                            stream,
                            video,
                        });
                    }
                }
            });
            peer.addEventListener('iceconnectionstatechange', ev => {
                console.info("Peer ICE connection state:", ev.target.iceConnectionState);
                if (ev.target.iceConnectionState !== 'connected' && peer.iceConnectionState !== 'completed') {
                    for (const stream of ev.target.getRemoteStreams()) {
                        const inStream = this.inStreams.get(stream.id);
                        if (inStream) {
                            this.inStreams.delete(stream.id);
                            $(inStream.video).remove();
                        }
                    }
                }
            });
            for (const track of this.outStream.getTracks()) {
                peer.addTrack(track, this.outStream);
            }
            return peer;
        },

        sendOffer: async function(userId) {
            console.warn("Sending offer to:", userId);
            const peer = await this.createPeerConnection(userId);
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            console.assert(!this.peers.has(userId));
            this.peers.set(userId, peer);
            await this.model.sendControl({control: 'callOffer', offer}, null, {addrs: [userId]});
        },

        acceptOffer: async function(offer) {
            if (this.peers.has(offer.identity)) {
                debugger;
                console.warn('Dropping offer for known peer:', offer.identity);
                return;
            }
            console.warn("Accepting offer from:", offer.identity);
            this.$('.f-join-call.button').attr('disabled', 'disabled');
            this.$('.f-end-call.button').removeAttr('disabled');
            const peer = await this.createPeerConnection(offer.identity);
            await peer.setRemoteDescription(new RTCSessionDescription(offer.desc));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            this.peers.set(offer.identity, peer);
            await this.model.sendControl({control: 'callAnswer', answer}, null,
                                         {addrs: [offer.identity]});
        },

        onHide: function() {
            this.endCall();
            F.ModalView.prototype.onHide.apply(this, arguments);
        },

        onAnswer: async function(sender, answer) {
            const peer = this.peers.get(sender);
            this.xxxPeerAnswers[sender] = (this.xxxPeerAnswers[sender] || 0) + 1;
            if (this.xxxPeerAnswers[sender] > 1) {
                debugger;
            }
            console.warn("Processing answer from:", sender, answer);
            try {
                await peer.setRemoteDescription(new RTCSessionDescription(answer));
            } catch(e) {
                debugger;
            }
        },

        onICECandidate: async function(sender, candidate) {
            const peer = this.peers.get(sender);
            try {
                await peer.addIceCandidate(new RTCIceCandidate(candidate));
            } catch(e) {
                debugger;
            }
        }
    });
})();
