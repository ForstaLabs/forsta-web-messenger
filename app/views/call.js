// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.CallView = F.ModalView.extend({
        template: 'views/call.html',
        className: 'f-call ui modal',

        initialize: function(options) {
            this.peers = new Map();
            this.offer = options.offer;
            this.on('icecandidate', this.onICECandidate);
            this.on('answer', this.onAnswer);
            F.ModalView.prototype.initialize(options);
        },

        events: {
            'click .f-start-call.button': 'onStartCallClick',
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
                this.stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
            } catch(e) {
                this.error = e.message;
            }
            await F.View.prototype.render.call(this);
            if (!this.error) {
                this.$('.f-video.local')[0].srcObject = this.stream;
            }
            if (this.offer) {
                const offer = this.offer;
                this.offer = undefined;
                await this.acceptOffer(offer);
                // Announce ourselves to the rest of the thread given that we just joined.
                const users = await this.model.getMembers(/*excludePending*/ true);
                const otherUsers = users.filter(x => x !== F.currentUser.id && x !== offer.identity);
                await Promise.all(otherUsers.map(x => this.sendOffer(x)));
            }
            return this;
        },

        setStatus: function(value) {
            this.$('.f-call-status').text(value);
        },

        endCall: function() {
            const peers = new Map(this.peers);
            this.peers.clear();
            for (const peer of peers.values()) {
                peer.close();
            }
            if (this.stream) {
                for (const track of this.stream.getTracks()) {
                    track.stop();
                }
                this.stream = null;
            }
            this.$('.f-start-call.button').removeAttr('disabled');
            this.$('.f-end-call.button').attr('disabled', 'disabled');
        },

        addPeerConnection: async function(peerIdentity) {
            const iceServers = await F.atlas.getRTCServersFromCache();
            const peer = new RTCPeerConnection({peerIdentity, iceServers}); // XXX vet use of peer ident
            peer.addStream(this.stream);
            peer.addEventListener('icecandidate', async ev => {
                if (!ev.candidate) {
                    return;  // Drop the empty one we start with.
                }
                await this.model.sendControl({
                    control: 'callICECandidate',
                    icecandidate: ev.candidate
                }, null, {addrs: [peerIdentity]});
            });
            peer.addEventListener('addstream', ev => {
                console.info("Add remote stream:", ev.stream);
                const video = $('<video class="f-video remote" controls autoplay/></video>');
                video[0].srcObject = ev.stream;
                this.$('.f-videos').append(video);
            });
            peer.addEventListener('removestream', ev => {
                debugger;
                console.error("PEER XXX", ev);
            });
            peer.addEventListener('connectionstatechange', ev => {
                debugger;
                console.error("PEER XXX", ev);
            });
            peer.addEventListener('iceconnectionstatechange', ev => {
                console.info("Peer ICE connection state:", ev.target.iceConnectionState);
            });
            peer.addEventListener('icegatheringstatechange', ev => {
                console.info("Peer gather state:", ev.target.iceGatheringState);
            });
            peer.addEventListener('identityresult', ev => {
                debugger;
                console.error("PEER XXX", ev);
            });
            peer.addEventListener('identityresult', ev => {
                debugger;
                console.error("PEER XXX", ev);
            });
            peer.addEventListener('peeridentity', ev => {
                debugger;
                console.error("PEER XXX", ev);
            });
            peer.addEventListener('signalingstatechange', ev => {
                console.info("Peer signaling state:", ev.target.signalingState);
            });
            peer.addEventListener('track', ev => {
                console.warn("Peer track", ev);
            });
            
            console.assert(!this.peers.has(peerIdentity));
            this.peers.set(peerIdentity, peer);
            return peer;
        },

        sendOffer: async function(userId) {
            const peer = await this.addPeerConnection(userId);
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            await this.model.sendControl({control: 'callOffer', offer}, null, {addrs: [userId]});
            this.peers.set(userId, peer);
            return peer;
        },

        acceptOffer: async function(offer) {
            this.$('.f-start-call.button').attr('disabled', 'disabled');
            this.$('.f-end-call.button').removeAttr('disabled');
            const peer = await this.addPeerConnection(offer.identity);
            await peer.setRemoteDescription(new RTCSessionDescription(offer.desc));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await this.model.sendControl({control: 'callAnswer', answer}, null,
                                         {addrs: [offer.identity]});
            this.peers.set(offer.identity, peer);
            return peer;
        },

        onHide: function() {
            this.endCall();
            F.ModalView.prototype.onHide.apply(this, arguments);
        },

        onStartCallClick: async function(ev) {
            this.$('.f-start-call.button').attr('disabled', 'disabled');
            this.$('.f-end-call.button').removeAttr('disabled');
            console.assert(!this.peers.length);
            const users = await this.model.getMembers(/*excludePending*/ true);
            await Promise.all(users.filter(x => x !== F.currentUser.id).map(x => this.sendOffer(x)));
        },

        onAnswer: async function(sender, answer) {
            const peer = this.peers.get(sender);
            await peer.setRemoteDescription(new RTCSessionDescription(answer));
        },

        onICECandidate: async function(sender, candidate) {
            const peer = this.peers.get(sender);
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });
})();
