// vim: ts=4:sw=4:expandtab
/* global relay, platform, chrome */

(function () {
    'use strict';

    self.F = self.F || {};

    const canFullscreen = document.fullscreenEnabled ||
                          document.mozFullScreenEnabled ||
                          document.webkitFullscreenEnabled;
    const chromeExtUrl = `https://chrome.google.com/webstore/detail/${F.env.SCREENSHARE_CHROME_EXT_ID}`;
    const chromeWebStoreImage = F.util.versionedURL(F.urls.static + 'images/chromewebstore_v2.png');

    let _audioCtx;
    function getAudioContext() {
        // There are limits to how many of these we can use, so share..
        if (_audioCtx === undefined) {
            const _AudioCtx = self.AudioContext || self.webkitAudioContext;
            _audioCtx = _AudioCtx ? new _AudioCtx() : null;
            if (!_audioCtx) {
                console.warn("Audio not supported");
            }
        }
        return _audioCtx;
    }

    function getDummyAudioTrack() {
        const ctx = getAudioContext();
        const oscillator = ctx.createOscillator();
        const dst = oscillator.connect(ctx.createMediaStreamDestination());
        oscillator.start();
        const track = dst.stream.getAudioTracks()[0];
        track.enabled = false;
        track.dummy = true;
        return track;
    }

    function getDummyVideoTrack() {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const track = canvas.captureStream().getVideoTracks()[0];
        track.dummy = true;
        return track;
    }

    function getDummyMediaStream() {
        return new MediaStream([getDummyVideoTrack(), getDummyAudioTrack()]);
    }

    function isPeerConnectState(iceState) {
        return iceState === 'connected' || iceState === 'completed';
    }

    function chromeScreenShareExtRPC(msg) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(F.env.SCREENSHARE_CHROME_EXT_ID, msg, resp => {
                if (!resp) {
                    reject(new ReferenceError('ext not found'));
                } else if (resp.success) {
                    resolve(resp.data);
                } else {
                    reject(resp.error);
                }
            });
        });
    }

    async function hasChromeScreenSharingExt() {
        if (!self.chrome || !self.chrome.runtime) {
            console.warn("Unsupported browser");
            return false;
        }
        try {
            await chromeScreenShareExtRPC({type: 'ping'});
        } catch(e) {
            if (e instanceof ReferenceError) {
                return false;
            }
            throw e;
        }
        return true;
    }

    async function requestChromeScreenSharing() {
        return await chromeScreenShareExtRPC({type: 'rpc', call: 'chooseDesktopMedia'});
    }


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
            F.ModalView.prototype.initialize.call(this, options);
        },

        events: {
            'click .f-join-call.button': 'onJoinClick',
            'click .f-leave-call.button': 'onLeaveClick',
            'click .f-audience .f-call-member': 'onClickAudience',
            'click .f-presenter .f-call-member': 'onClickPresenter',
            'click .f-video-mute.button': 'onVideoMuteClick',
            'click .f-audio-mute.button': 'onAudioMuteClick',
            'click .f-fullscreen.button': 'onFullscreenClick',
        },

        render_attributes: function() {
            return {
                thread: this.model,
                canFullscreen,
            };
        },

        render: async function() {
            F.assert(!this._rendered);
            // Skip modal render which we don't want.
            await F.View.prototype.render.call(this);
            this.$('.ui.dropdown').dropdown({
                action: 'hide',
                onChange: value => {
                    if (value === 'settings') {
                        this.onSettingsSelect();
                    } else if (value === 'screen-sharing') {
                        this.onScreenSharingSelect();
                    } else {
                        throw new Error("invalid selection");
                    }
                }
            });
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
            this.outView.bindStream(await this.getOutStream());
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
            F.util.playAudio('/audio/call-dial.ogg');
        },

        leave: function() {
            if (!this.isJoined()) {
                return;
            }
            for (const view of this.memberViews.values()) {
                if (view === this.outView) {
                    continue;
                }
                view.trigger('leave', {silent: true});
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
            /*
             * WebRTC JSEP rules require a media section in the offer sdp.. So fake it!
             * Also if we don't include both video and audio the peer won't either.
             * Ref: https://rtcweb-wg.github.io/jsep/#rfc.section.5.8.2
             */
            const md = navigator.mediaDevices;
            const availDevices = new Set((await md.enumerateDevices()).map(x => x.kind));
            const bestAudio = {
                autoGainControl: true,
                echoCancellation: true,
                noiseSuppression: true,
            };
            const bestVideo = {
                width: {min: 320, ideal: 1280, max: 1920},
                height: {min: 180, ideal: 720, max: 1080},
            };
            if (availDevices.has('audioinput') && availDevices.has('videoinput')) {
                return await md.getUserMedia({audio: bestAudio, video: bestVideo});
            } else if (availDevices.has('audioinput')) {
                this.setCallStatus('<i class="icon yellow warning sign"></i> ' +
                                   'Video device not available.');
                const stream = await md.getUserMedia({audio: bestAudio});
                stream.addTrack(getDummyVideoTrack());
                return stream;
            } else if (availDevices.has('videoinput')) {
                this.setCallStatus('<i class="icon yellow warning sign"></i> ' +
                                   'Audio device not available.');
                const stream = await md.getUserMedia({video: bestVideo});
                stream.addTrack(getDummyAudioTrack());
                return stream;
            } else {
                this.setCallStatus('<i class="icon red warning sign"></i> ' +
                                   'Video or audio device not available.');
                return getDummyMediaStream();
            }
        },

        checkSoundLevels: function() {
            if (this._presenter.isPinned()) {
                return;
            }
            let loudest = this._presenter;
            const threshold = 0.01;
            for (const view of this.memberViews.values()) {
                if (view.soundLevel - loudest.soundLevel >= threshold) {
                    loudest = view;
                }
            }
            if (this._presenter !== loudest) {
                this.selectPresenter(loudest);
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
                    console.info("Binding new media stream for:", userId);
                }
                // Be sure to call everytime so we are aware of all tracks.
                // Using MediaStream.onaddtrack does not work as expected.
                view.bindStream(stream);
            });
            for (const track of this.outView.stream.getTracks()) {
                peer.addTrack(track, this.outView.stream);
            }
            return peer;
        },

        isJoined: function() {
            return this.$el.hasClass('joined');
        },

        getFullscreenElement() {
            return this.$el.closest('.ui.modals.page')[0];
        },

        requestFullscreen: function() {
            // Make the entire modals holder full screen any modals generated in our view also
            // show up.  Otherwise they just get eaten while in fullscreen mode.
            const el = this.getFullscreenElement();
            const func = el.requestFullscreen ||
                         el.mozRequestFullScreen ||
                         el.webkitRequestFullscreen;
            if (!func) {
                console.warn("requestFullscreen function not available");
            } else {
                return func.call(el);
            }
        },

        exitFullscreen: function() {
            const func = document.exitFullscreen ||
                         document.mozCancelFullScreen ||
                         document.webkitExitFullscreen;
            if (!func) {
                console.warn("exitFullscreen function not available");
            } else {
                return func.call(document);
            }
        },

        isFullscreen: function() {
            const el = document.fullscreenElement ||
                       document.mozFullScreenElement ||
                       document.webkitFullscreenElement;
            return !!(el && el === this.getFullscreenElement());
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
            view.trigger('leave', {status: 'Left'});
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

        onFullscreenClick: async function(ev) {
            const $icon = this.$('.f-fullscreen.button .icon');
            if (this.isFullscreen()) {
                this.exitFullscreen();
                $icon.removeClass('compress').addClass('expand');
            } else {
                this.requestFullscreen();
                $icon.removeClass('expand').addClass('compress');
            }
        },

        onSettingsSelect: async function() {
            const view = new CallSettingsView();
            await view.show();
        },

        onScreenSharingSelect: async function() {
            const md = navigator.mediaDevices;
            const browser = platform.name.toLowerCase();
            const nativeSupport = browser === 'firefox';
            let stream;
            if (nativeSupport) {
                stream = await md.getUserMedia({video: {mediaSource: 'screen'}});
            } else if (browser === 'chrome') {
                if (await hasChromeScreenSharingExt()) {
                    const sourceId = await requestChromeScreenSharing();
                    stream = await md.getUserMedia({
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: sourceId
                            }
                        }
                    });
                } else {
                    F.util.promptModal({
                        size: 'tiny',
                        allowMultiple: true,
                        header: 'Chrome Extension Required',
                        content: 'For security reasons Chrome does not allow screen sharing without ' +
                                 'a specialized browser extension..<br/><br/> ' +
                                 'Add the extension from the Chrome Web Store and reload this page. ' +
                                 `<a target="_blank" href="${chromeExtUrl}">` +
                                 `<img class="ui image small" src="${chromeWebStoreImage}"/></a>`
                    });
                }
            } else {
                F.util.promptModal({
                    size: 'tiny',
                    allowMultiple: true,
                    header: 'Unsupported Browser',
                    content: 'Screen sharing is only supported in Firefox and Chrome.'
                });
            }
            if (stream) {
                /* Reuse existing streams to avoid peer rebinding. */
                const tracks = stream.getTracks();
                F.assert(tracks.length === 1);
                const track = tracks[0];
                F.assert(track.kind === 'video');
                for (const x of Array.from(this.outView.stream.getVideoTracks())) {
                    this.outView.stream.removeTrack(x);
                }
                this.outView.stream.addTrack(track);
                this.outView.bindStream(this.outView.stream);  // Recalc info about our new track.
                for (const view of this.memberViews.values()) {
                    if (!view.peer) {
                        continue;
                    }
                    for (const sender of view.peer.getSenders()) {
                        if (sender.track.kind === 'video') {
                            await sender.replaceTrack(track);
                        }
                    }
                }
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
            F.util.playAudio('/audio/call-leave.ogg');
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
            this.on('connect', this.onConnect.bind(this));
            this.on('disconnect', this.onDisconnect.bind(this));
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
            if (stream !== this.stream) {
                this.unbindStream();
                this.stream = stream;
                // XXX These are not usable.  Probably remove them..
                stream.addEventListener('addtrack', this.onAddTrack);
                stream.addEventListener('removetrack', this.onRemoveTrack);
            }
            const muted = this.isMuted();
            let hasAudio = false;
            let hasVideo = false;
            for (const track of stream.getTracks()) {
                this.stopTrackListeners(track);  // need to debounce
                this.startTrackListeners(track);
                if (track.kind === 'audio' && muted) {
                    track.enabled = false;
                }
                if (!track.dummy) {
                    if (track.kind === 'audio') {
                        hasAudio = true;
                    } else if (track.kind === 'video') {
                        hasVideo = true;
                    }
                }
            }
            const hasMedia = hasVideo || (hasAudio && !this.outgoing);
            if (hasAudio) {
                this.soundMeter = new SoundMeter(stream, levels => {
                    // The disconnect is not immediate, so we need to check our status.
                    if (this.soundMeter) {
                        this.soundLevel = levels.average;
                    }
                });
            } else {
                if (this.soundMeter) {
                    this.soundMeter.disconnect();
                    this.soundMeter = null;
                }
                this.soundLevel = -1;
            }
            if (hasMedia) {
                this.$('video')[0].srcObject = this.stream;
            } else {
                this.$('video')[0].srcObject = null;
            }
            let streaming = false;
            if (this.outgoing) {
                streaming = hasMedia;
            } else if (this.peer) {
                streaming = hasMedia && isPeerConnectState(this.peer.iceConnectionState);
            }
            this._lastState = this.peer ? this.peer.iceConnectionState : null;
            if (streaming) {
                this.trigger('connect');
            }
        },

        unbindStream: function(options) {
            options = options || {};
            if (this.isStreaming()) {
                this.trigger('disconnect', {silent: options.silent});
            }
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
            this._lastState = null;
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

        onLeave: function(options) {
            options = options || {};
            this.left = true;
            this.unbindStream({silent: options.silent});
            this.unbindPeer();
            this.setStatus(options.status);
        },

        onConnect: function() {
            this.$el.addClass('streaming');
            if (!this.outgoing) {
                F.util.playAudio('/audio/call-peer-join.ogg');
            }
        },

        onDisconnect: function(options) {
            options = options || {};
            this.$el.removeClass('streaming');
            if (!this.outgoing && !options.silent) {
                F.util.playAudio('/audio/call-leave.ogg');
            }
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
                const streaming = hasMedia && isPeerConnectState(state);
                if (streaming && !isPeerConnectState(this._lastState)) {
                    this.trigger('connect');
                } else if (!streaming && isPeerConnectState(this._lastState)) {
                    this.trigger('disconnect');
                }
                F.assert(streaming === this.isStreaming());
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
        }
    });


    const CallSettingsView = F.ModalView.extend({
        contentTemplate: 'views/call-settings.html',
        extraClass: 'f-call-settings-view',
        size: 'tiny',
        allowMultiple: true,
    });


    class SoundMeter {
        // Adapted from: https://github.com/webrtc/samples/blob/gh-pages/src/content/getusermedia/volume/js/soundmeter.js

        constructor(stream, onLevel) {
            this.current = 0;  // public
            this.average = 0;  // public
            const ctx = getAudioContext();
            if (!ctx) {
                return;
            }
            this.script = ctx.createScriptProcessor(2048, 1, 1);
            this.script.addEventListener('audioprocess', event => {
                const input = event.inputBuffer.getChannelData(0);
                let sum = 0;
                for (const x of input) {
                    sum += x * x;
                }
                this.current = Math.sqrt(sum / input.length);
                this.average = 0.95 * this.average + 0.05 * this.current;
                onLevel({
                    current: this.current,
                    average: this.average
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
