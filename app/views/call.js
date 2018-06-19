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
            this.offer = options.offer;
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
            await F.View.prototype.render.call(this);
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
            console.assert(!this.sessions.size);
            console.assert(!this.pendingPeers.size);
            this.$('.f-join-call.button').attr('disabled', 'disabled');
            this.$('.f-end-call.button').removeAttr('disabled');
            if (!this.outStream) {
                await this.attachOutStream();
            }
            const users = await this.model.getMembers(/*excludePending*/ true);
            await Promise.all(users.filter(x => x !== F.currentUser.id).map(x => this.sendOffer(x)));
        },

        endCall: function() {
            const sessions = Array.from(this.sessions.values());
            const pending = Array.from(this.pendingPeers.values());
            this.sessions.clear();
            this.pendingPeers.clear();
            if (this.outStream) {
                this.detachOutStream();
            }
            for (const x of sessions) {
                x.peer.close();
                x.el.remove();
                // XXX Need?
                //for (const track of peer.stream.getTracks()) {
                //    track.stop();
                //}
            }
            for (const x of pending) {
                x.close();
            }
            this.$('.f-join-call.button').removeAttr('disabled');
            this.$('.f-end-call.button').attr('disabled', 'disabled');
        },

        attachOutStream: async function(screen) {
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
            } catch(e) {
                this.setStatus('ERROR: ' + e.message);
                return;
            }
            this.$('.f-video.local')[0].srcObject = stream;
            console.assert(!this.outStream);
            this.outStream = stream;
        },

        detachOutStream: function() {
            console.assert(this.outStream);
            const stream = this.outStream;
            this.outStream = null;
            const $video = this.$('.f-video.local');
            $video[0].srcObject = null;
            for (const track of stream.getTracks()) {
                track.stop();
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
            session.el[0].srcObject = null;
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
                for (const stream of ev.streams) {
                    if (this.getPeerByStream(stream)) {
                        console.debug("Ignoring known stream:", stream);
                    } else {
                        console.assert(!this.sessions.has(peerIdentity));
                        console.info("Adding Media Stream from peer connection:", peerIdentity, stream.id);
                        const $video = $('<video class="f-video remote" autoplay/></video>');
                        $video[0].srcObject = stream;
                        this.$('.f-videos').append($video);
                        this.sessions.set(peerIdentity, {
                            id: peerIdentity,
                            el: $video,
                            stream,
                            peer,
                        });
                    }
                }
            });
            peer.addEventListener('iceconnectionstatechange', ev => {
                console.info("Peer ICE connection state:", ev.target.iceConnectionState);
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
            console.assert(!this.pendingPeers.has(userId));
            this.pendingPeers.set(userId, peer);
            await this.model.sendControl({control: 'callOffer', offer}, null, {addrs: [userId]});
        },

        acceptOffer: async function(offer) {
            if (!this.outStream) {
                await this.attachOutStream();
            }
            if (this.sessions.has(offer.identity)) {
                console.warn('Reseting stale session:', offer.identity);
                this.removeSession(offer.identity);
            }
            console.info("Accepting offer from:", offer.identity);
            this.$('.f-join-call.button').attr('disabled', 'disabled');
            this.$('.f-end-call.button').removeAttr('disabled');
            const peer = await this.createPeerConnection(offer.identity);
            await peer.setRemoteDescription(new RTCSessionDescription(offer.desc));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await this.model.sendControl({control: 'callAnswer', answer}, null,
                                         {addrs: [offer.identity]});
        },

        onHide: function() {
            this.endCall();
            F.ModalView.prototype.onHide.apply(this, arguments);
        },

        onAnswer: async function(sender, answer) {
            const peer = this.pendingPeers.get(sender);
            if (!peer) {
                throw new ReferenceError("Pending peer not found for offer answer");
            }
            this.pendingPeers.delete(sender);
            await peer.setRemoteDescription(new RTCSessionDescription(answer));
        },

        onICECandidate: async function(sender, candidate) {
            let peer;
            if (this.sessions.has(sender)) {
                peer = this.sessions.get(sender).peer;
            } else {
                peer = this.pendingPeers.get(sender);
                if (peer) {
                    console.error("XXX unexpected");
                }
            }
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });
})();
