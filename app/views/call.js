// vim: ts=4:sw=4:expandtab
/* global relay, platform, chrome, moment */

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
        closable: false,  // Prevent accidents and broken fullscreen behavior in safari.

        initialize: function(options) {
            this.callId = options.callId;
            this.originator = options.originator;
            this.members = options.members;
            this.forceScreenSharing = options.forceScreenSharing;
            this.memberViews = new Map();
            this.on('peericecandidates', this.onPeerICECandidates);
            this.on('peeracceptoffer', this.onPeerAcceptOffer);
            this.on('peerleave', this.onPeerLeave);
            this._soundCheckInterval = setInterval(this.checkSoundLevels.bind(this), 500);
            this._onFullscreenChange = this.onFullscreenChange.bind(this);
            for (const fullscreenchange of ['mozfullscreenchange', 'webkitfullscreenchange', 'fullscreenchange']) {
                document.addEventListener(fullscreenchange, this._onFullscreenChange);
            }
            options.modalOptions = {
                detachable: false  // Prevent move to inside dimmer so we can manually manage detached
                                   // state ourselves in toggleDetached.
            };
            F.ModalView.prototype.initialize.call(this, options);
        },

        events: {
            'click .f-join-call.button:not(.loading)': 'onJoinClick',
            'click .f-leave-call.button:not(.loading)': 'onLeaveClick',
            'click .f-video.mute.button': 'onVideoMuteClick',
            'click .f-audio.mute.button': 'onAudioMuteClick',
            'click .f-detach.button': 'onDetachClick',
            'click .f-fullscreen.button': 'onFullscreenClick',
            'click .f-close.button': 'onCloseClick',
            'click .ui.popup .f-pin': 'onPopupPinClick',
            'click .ui.popup .f-silence': 'onPopupSilenceClick',
            'click .ui.popup .f-restart': 'onPopupRestartClick',
            'pointerdown > .header': 'onHeaderPointerDown',
        },

        render_attributes: function() {
            return {
                thread: this.model,
                canFullscreen,
                forceScreenSharing: this.forceScreenSharing,
            };
        },

        show: async function() {
            await this.toggleDetached(!F.util.isSmallScreen());
        },

        render: async function() {
            const firstRender = !this._rendered;
            await F.View.prototype.render.call(this);  // Skip modal render which we don't want.
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
            if (firstRender) {
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
                this.presenterView = await new F.CallPresenterView();
                this.$('.f-presenter').append(this.presenterView.$el);

                F.assert(!this.outView);
                for (const x of this.members) {
                    const view = await this.addMemberView(x);
                    if (x === F.currentUser.id) {
                        this.outView = view;
                    }
                }
                this.outView.bindStream(await this.getOutStream());
            } else {
                for (const view of this.memberViews.values()) {
                    await view.render();
                    if (view.stream) {
                        await view.bindStream(null, {silent: true});
                    }
                }
            }
            if (firstRender) {
                await this.selectPresenter(this.outView);
            } else {
                await this.presenterView.select(this._presenting);
            }
            return this;
        },

        addMemberView: async function(userId) {
            F.assert(!this.memberViews.has(userId));
            const order = this.members.indexOf(userId);
            const view = new F.CallMemberView({userId, order});
            view.on('pinned', this.onMemberPinned.bind(this));
            view.on('restart', this.onMemberRestart.bind(this));
            if (view.outgoing) {
                view.on('silenced', this.onOutgoingMemberSilenced.bind(this));
            }
            await view.render();
            this.memberViews.set(userId, view);
            this.$('.f-audience').append(view.$el);
            return view;
        },

        setCallStatus: function(value) {
            this.$('.f-call-status').html(value);
        },

        setJoined: function(joined) {
            joined = joined !== false;
            if (joined) {
                this._joined = this._joined || Date.now();
            } else {
                this._left = this._left || Date.now();
            }
            this.$el.toggleClass('joined', joined);
            if (joined) {
                this.$('.f-join-call.button').attr('disabled', 'disabled').removeClass('loading');
                this.$('.f-leave-call.button').removeAttr('disabled');
            } else {
                this.$('.f-join-call.button').removeAttr('disabled');
                this.$('.f-leave-call.button').attr('disabled', 'disabled').removeClass('loading');
            }
        },

        join: async function(options) {
            options = options || {};
            if (this._joining) {
                return;
            }
            this._joining = true;
            try {
                const joining = [];
                if (!options.silent) {
                    F.util.playAudio('/audio/call-dial.ogg');  // bg okay
                    this.$('.f-join-call.button').addClass('loading');
                }
                for (const view of this.memberViews.values()) {
                    if (view.userId === F.currentUser.id) {
                        continue;
                    }
                    if (view.peer) {
                        if (options.restart) {
                            view.stop({silent: options.silent});
                        } else {
                            continue;
                        }
                    }
                    joining.push(this.sendOffer(view.userId));
                }
                await Promise.all(joining);
                this.setJoined(true);
            } finally {
                this._joining = false;
            }
        },

        leave: async function() {
            if (!this.isJoined() || this._leaving) {
                return;
            }
            this._leaving = true;
            try {
                this.$('.f-leave-call.button').addClass('loading');
                const leaving = [];
                for (const view of this.memberViews.values()) {
                    if (view === this.outView) {
                        continue;
                    }
                    view.stop({silent: true});
                    leaving.push(this.sendControl('callLeave', view.userId));
                }
                await Promise.all(leaving);
                this.setJoined(false);
                F.util.playAudio('/audio/call-leave.ogg');  // bg okay
            } finally {
                this._leaving = false;
            }
        },

        remove: function() {
            clearInterval(this._soundCheckInterval);
            this._soundCheckInterval = null;
            this.leave();
            for (const view of this.memberViews.values()) {
                view.remove();
            }
            this.memberViews.clear();
            for (const fullscreenchange of ['mozfullscreenchange', 'webkitfullscreenchange']) {
                document.removeEventListener(fullscreenchange, this._onFullscreenChange);
            }
            if (this._joined) {
                if (!this._left) {
                    this._left = Date.now();
                }
                const elapsed = moment.duration(this._left - this._joined);
                this.model.createMessage({
                    type: 'clientOnly',
                    plain: `You were in a call for ${elapsed.humanize()}.`
                });
            }
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
                const offer = this.limitBandwidth(await peer.createOffer(), await F.state.get('callIngressBps'));
                await peer.setLocalDescription(offer);
                view.setStatus('Calling');
                const called = view.statusChanged;
                console.info("Sending offer to:", userId);
                await this.sendControl('callOffer', userId, {
                    offer,
                    peerId: peer._id
                });
                relay.util.sleep(30).then(() => {
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
                await peer.setRemoteDescription(this.limitBandwidth(data.offer, await F.state.get('callEgressBps')));
                F.assert(peer.remoteDescription.type === 'offer');
                const answer = this.limitBandwidth(await peer.createAnswer(), await F.state.get('callIngressBps'));
                await peer.setLocalDescription(answer);
                await this.sendControl('callAcceptOffer', userId, {
                    peerId: data.peerId,
                    answer
                });
                view.toggleDisabled(false);
            });
            this.setJoined(true);
            setTimeout(() => this.join({silent: true}), 200);  // Let all accept offers flood in first. XXX HACK
        },

        limitBandwidth: function(desc, bandwidth) {
            // Bitrate control is not consistently supported.  This code is basically
            // best effort, in that some clients will handle the AS bitrate statement
            // and others TIAS.
            const sdp = desc.sdp.split(/\r\n/);
            /* Look for existing bitrates and if they are lower use them.  We only look
             * in the video section, hence this strange loop.  We save a reference to
             * the video section for disection later on too. */
            let videoOffset;
            for (let i = 0; i < sdp.length; i++) {
                const line = sdp[i];
                if (videoOffset) {
                    if (line.startsWith('b=')) {
                        const adjust = line.startsWith('b=AS') ? 1024 : 1;
                        const bps = Number(line.split(':')[1]) * adjust;
                        if (!bandwidth || bps < bandwidth) {
                            bandwidth = bps;
                        }
                        sdp.splice(i, 1);
                    } else if (line.startsWith('m=')) {
                        // This assumes there is only one video section.
                        break;
                    }
                } else if (line.startsWith('m=video')) {
                    videoOffset = i + 1;
                }
            }
            if (bandwidth) {
                const bps = Math.round(bandwidth);
                const kbps = Math.round(bandwidth / 1024);
                for (let i = videoOffset; i < sdp.length; i++) {
                    const line = sdp[i];
                    if (line.startsWith('c=IN')) {
                        sdp.splice(i + 1, 0, `b=TIAS:${bps}`);
                        sdp.splice(i + 2, 0, `b=AS:${kbps}`);
                        break;
                    }
                }
            }
            return new RTCSessionDescription({
                type: desc.type,
                sdp: sdp.join('\r\n')
            });
        },

        getOutStream: async function(options) {
            /*
             * WebRTC JSEP rules require a media section in the offer sdp.. So fake it!
             * Also if we don't include both video and audio the peer won't either.
             * Ref: https://rtcweb-wg.github.io/jsep/#rfc.section.5.8.2
             */
            let stream;
            if (this.forceScreenSharing) {
                stream = await this.getScreenSharingStream();
                if (!stream) {
                    stream = new MediaStream([getDummyVideoTrack()]);
                }
                stream.addTrack(getDummyAudioTrack());
                return stream;
            }
            options = options || {};
            const md = navigator.mediaDevices;
            const availDevices = new Set((await md.enumerateDevices()).map(x => x.kind));
            if (options.videoOnly) {
                availDevices.delete('audioinput');
            } else if (options.audioOnly) {
                availDevices.delete('videoinput');
            }
            const bestAudio = {
                autoGainControl: true,
                echoCancellation: true,
                noiseSuppression: true,
            };
            let bestVideo = true;
            if (platform.name !== 'Safari') {  // XXX
                const videoResolution = await F.state.get('callVideoResolution', 'auto');
                if (videoResolution === 'low') {
                    bestVideo = {
                        height: {ideal: 240},
                        frameRate: {ideal: 5}
                    };
                } else if (videoResolution === 'high') {
                    bestVideo = {
                        height: {ideal: 2160},
                        frameRate: {ideal: 60}
                    };
                } else if (videoResolution !== 'auto') {
                    bestVideo = true;
                    console.error("Invalid Video Resolution:", videoResolution);
                }
            }
            async function getUserMedia(constraints) {
                try {
                    return await md.getUserMedia(constraints);
                } catch(e) {
                    console.error("Could not get audio/video device:", e);
                }
            }
            if (availDevices.has('audioinput') && availDevices.has('videoinput')) {
                stream = await getUserMedia({audio: bestAudio, video: bestVideo});
            } else if (availDevices.has('audioinput')) {
                stream = await getUserMedia({audio: bestAudio});
                if (stream && !options.audioOnly) {
                    stream.addTrack(getDummyVideoTrack());
                    this.setCallStatus('<i class="icon yellow warning sign"></i> ' +
                                       'Video device not available.');
                }
            } else if (availDevices.has('videoinput')) {
                stream = await getUserMedia({video: bestVideo});
                if (stream && !options.videoOnly) {
                    stream.addTrack(getDummyAudioTrack());
                    this.setCallStatus('<i class="icon yellow warning sign"></i> ' +
                                       'Audio device not available.');
                }
            }
            if (!stream) {
                if (options.audioOnly) {
                    stream = new MediaStream([getDummyAudioTrack()]);
                } else if (options.videoOnly) {
                    stream = new MediaStream([getDummyVideoTrack()]);
                } else {
                    stream = new MediaStream([getDummyVideoTrack(), getDummyAudioTrack()]);
                }
                this.setCallStatus('<i class="icon red warning sign"></i> ' +
                                   'Video or audio device not available.');
            }
            return stream;
        },

        checkSoundLevels: async function() {
            if (!this._presenting) {
                return;  // not rendered yet.
            }
            if (this._presenting.isPinned() ||
                (this._lastPresenterSwitch && Date.now() - this._lastPresenterSwitch < 2000)) {
                return;
            }
            let loudest = this._presenting;
            for (const view of this.memberViews.values()) {
                if (view.soundLevel - loudest.soundLevel >= 0.01) {
                    loudest = view;
                }
            }
            if (this._presenting !== loudest) {
                await this.selectPresenter(loudest);
                this._lastPresenterSwitch = Date.now();
            }
        },

        selectPresenter: async function(view) {
            if (this._presenting === view) {
                return;
            }
            this._presenting = view;
            await this.presenterView.select(view);
        },

        bindPeerConnection: async function(view, peerId) {
            const iceServers = await F.atlas.getRTCServersFromCache();
            const peer = new RTCPeerConnection({iceServers});
            const userId = view.userId;
            peer._id = peerId;  // Not to be confused with the peerIdentity spec prop.
            view.bindPeer(peer);
            peer.addEventListener('icecandidate', F.buffered(async eventArgs => {
                const icecandidates = eventArgs.map(x => x[0].candidate).filter(x => x);
                console.warn(`Sending ${icecandidates.length} ICE candidate(s) to`, userId);
                await this.sendControl('callICECandidates', userId, {icecandidates, peerId});
            }, 400, {max: 1000}));
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

        getFullscreenElement: function() {
            return $('body > .ui.modals')[0];
        },

        isFullscreen: function() {
            const el = F.util.fullscreenElement();
            return !!(el && el === this.getFullscreenElement());
        },

        isDetached: function() {
            return this.$el.hasClass('detached');
        },

        toggleDetached: async function(detached) {
            detached = detached === undefined ? !this.isDetached() : detached !== false;
            this.$el.toggleClass('detached', detached);
            const $modals = $('body > .ui.modals');
            if (detached) { 
                $('body').append(this.$el);
                this.$el.modal('show');
                if (!$modals.children('.ui.modal').length) {
                    $modals.dimmer('hide');
                }
            } else {
                // Clear any fixed positioning from moving..
                this.$el.css({top: '', left: '', right: '', bottom: ''});
                $modals.append(this.$el);
                this.$el.modal('show');
                $modals.dimmer('show');
            }
            await this.render();
        },

        replaceMembersOutTrack: async function(track) {
            for (const view of this.memberViews.values()) {
                if (!view.peer) {
                    continue;
                }
                const replacing = [];
                for (const sender of view.peer.getSenders()) {
                    if (sender.track.kind === track.kind) {
                        replacing.push(sender.replaceTrack(track));
                    }
                }
                await Promise.all(replacing);
            }
        },

        onPeerAcceptOffer: async function(userId, data) {
            F.assert(data.callId === this.callId);
            const view = this.memberViews.get(userId);
            const peer = view && view.peer;
            if (!peer || peer._id !== data.peerId) {
                console.error("Dropping accept-offer for invalid peer:", userId);
                return;
            }
            console.info("Peer accepted our call offer:", userId);
            await peer.setRemoteDescription(this.limitBandwidth(data.answer, await F.state.get('callEgressBps')));
            view.toggleDisabled(false);
        },

        onPeerICECandidates: async function(userId, data) {
            F.assert(data.callId === this.callId);
            F.assert(data.peerId);
            const view = this.memberViews.get(userId);
            const peer = view && view.peer;
            if (!peer || peer._id !== data.peerId) {
                console.error("Dropping ICE candidate for peer connection we don't have:", data);
                return;
            }
            console.debug(`Adding ${data.icecandidates.length} ICE candidate(s) for:`, userId);
            await Promise.all(data.icecandidates.map(x => peer.addIceCandidate(new RTCIceCandidate(x))));
        },

        onPeerLeave: async function(userId, data) {
            console.warn('Peer left call:', userId);
            const view = this.memberViews.get(userId);
            if (!view) {
                console.error("Dropping peer-leave reqeust for unknown peer:", data);
                return;
            }
            view.stop({status: 'Left'});
            view.toggleDisabled(true);
        },

        onJoinClick: async function() {
            await this.join();
        },

        onLeaveClick: async function() {
            await this.leave();
        },

        onVideoMuteClick: function(ev) {
            if (!this.outView.stream) {
                console.warn("No outgoing stream to mute");
            }
            const mute = !this.$el.hasClass('video-muted');
            this.$el.toggleClass('video-muted', mute);
            for (const track of this.outView.stream.getVideoTracks()) {
                track.enabled = !mute;
            }
        },

        onAudioMuteClick: function(ev) {
            if (!this.outView.stream) {
                console.warn("No outgoing stream to mute");
            }
            const mute = !this.$el.hasClass('audio-muted');
            this.$el.toggleClass('audio-muted', mute);
            this.outView.toggleSilenced(mute);
        },

        onDetachClick: async function(ev) {
            await this.toggleDetached();
        },

        onFullscreenClick: async function(ev) {
            if (this.isFullscreen()) {
                F.util.exitFullscreen();
            } else {
                const detached = this.isDetached();
                try {
                    await F.util.requestFullscreen(this.getFullscreenElement());  // bg okay
                } catch(e) {
                    console.warn("Could not enter fullscreen:", e);
                    return;
                }
                this._detachedBeforeFullscreen = detached;
                if (detached) {
                    // Must do this after the fullscreen request to avoid permission issue.
                    await this.toggleDetached(false);
                }
            }
        },

        onFullscreenChange: async function() {
            if (this.isFullscreen()) {
                this._fullscreenActive = true;
            } else if (this._fullscreenActive) {
                this._fullscreenActive = false;
                if (this._detachedBeforeFullscreen) {
                    await this.toggleDetached(true);
                }
            }
        },

        onCloseClick: async function() {
            this.hide();
        },

        onSettingsSelect: async function() {
            const view = new F.CallSettingsView({callView: this});
            await view.show();
        },

        onScreenSharingSelect: async function() {
            await this.startScreenSharing();
        },

        onHeaderPointerDown: function(ev) {
            // Support for moving detached view.
            if (!this.$el.hasClass('detached') || $(ev.target).closest(this.$('>.header .buttons')).length) {
                return;
            }
            const offsetX = ev.offsetX;
            const offsetY = ev.offsetY;
            const margin = 6;  // px
            const width = this.$el.width();
            const height = this.$el.height();
            const maxLeft = $('body').width() - width - margin;
            const maxTop = $('body').height() - height - margin;
            this.$el.addClass('moving');
            const top = Math.max(margin, Math.min(maxTop, ev.clientY - offsetY));
            const left = Math.max(margin, Math.min(maxLeft, ev.clientX - offsetX));
            this.el.style.setProperty('top', `${top}px`, 'important');
            this.el.style.setProperty('left', `${left}px`, 'important');
            this.el.style.setProperty('right', 'initial', 'important');
            this.el.style.setProperty('bottom', 'initial', 'important');
            const onMove = async ev => {
                await F.util.animationFrame();
                const top = Math.max(margin, Math.min(maxTop, ev.clientY - offsetY));
                const left = Math.max(margin, Math.min(maxLeft, ev.clientX - offsetX));
                this.el.style.setProperty('top', `${top}px`, 'important');
                this.el.style.setProperty('left', `${left}px`, 'important');
            };
            document.addEventListener('pointerup', ev => {
                this.$el.removeClass('moving');
                document.removeEventListener('pointermove', onMove);
            }, {once: true});
            document.addEventListener('pointermove', onMove);
        },

        startScreenSharing: async function() {
            const stream = await this.getScreenSharingStream();
            if (!stream) {
                return;
            }
            /* Reuse existing streams to avoid peer rebinding. */
            const tracks = stream.getTracks();
            F.assert(tracks.length === 1);
            const track = tracks[0];
            F.assert(track.kind === 'video');
            for (const x of Array.from(this.outView.stream.getVideoTracks())) {
                this.outView.stream.removeTrack(x);
                x.stop();
            }
            this.outView.stream.addTrack(track);
            this.outView.bindStream(this.outView.stream);  // Recalc info about our new track.
            track.addEventListener('ended', async () => {
                this.outView.stream.removeTrack(track);
                let videoTrack;
                if (this.forceScreenSharing) {
                    videoTrack = getDummyVideoTrack();
                } else {
                    const replacementStream = await this.getOutStream({videoOnly: true});
                    const videoTracks = replacementStream.getVideoTracks();
                    F.assert(videoTracks.length === 1);
                    videoTrack = videoTracks[0];
                }
                this.outView.stream.addTrack(videoTrack);
                await this.replaceMembersOutTrack(videoTrack);
            });
            await this.replaceMembersOutTrack(track);
        },

        getScreenSharingStream: async function() {
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
                    content: 'Screen sharing is only supported on Firefox and Desktop Chrome.'
                });
            }
            return stream;
        },

        onPopupPinClick: function(ev) {
            const viewId = $(ev.currentTarget).closest('.ui.popup').data('id');
            const view = this.memberViews.get(viewId);
            view.togglePinned();
        },

        onPopupSilenceClick: function(ev) {
            const viewId = $(ev.currentTarget).closest('.ui.popup').data('id');
            const view = this.memberViews.get(viewId);
            view.toggleSilenced();
        },

        onPopupRestartClick: function(ev) {
            const viewId = $(ev.currentTarget).closest('.ui.popup').data('id');
            const view = this.memberViews.get(viewId);
            view.restart();
        },

        onMemberPinned: async function(view, pinned) {
            if (pinned) {
                for (const x of this.memberViews.values()) {
                    if (x !== view) {
                        x.togglePinned(false);
                    }
                }
                await this.selectPresenter(view);
            }
        },

        onMemberRestart: async function(view) {
            await this.sendOffer(view.userId);
        },

        onOutgoingMemberSilenced: async function(view, silenced) {
            this.$el.toggleClass('audio-muted', silenced);
        }
    });


    F.CallMemberView = F.View.extend({

        template: 'views/call-member.html',
        className: 'f-call-member-view',

        initialize: function(options) {
            this.onTrackOverconstrained = this._onTrackOverconstrained.bind(this);
            this.onPeerICEConnectionStateChange = this._onPeerICEConnectionStateChange.bind(this);
            this.userId = options.userId;
            this.order = options.order;
            this.soundLevel = -1;
            this.outgoing = this.userId === F.currentUser.id;
            F.View.prototype.initialize(options);
        },

        startTrackListeners: function(track) {
            track.addEventListener('overconstrained', this.onTrackOverconstrained);
        },

        stopTrackListeners: function(track) {
            track.removeEventListener('overconstrained', this.onTrackOverconstrained);
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
            const firstRender = !this._rendered;
            await F.View.prototype.render.call(this);
            this.$el.popup({
                popup: this.getPopup(),
                position: 'top center',
                offset: 15,
                on: 'click',
                target: this.$el,
                lastResort: 'top center'
            });
            if (firstRender) {
                this.$el.css('order', this.order);
                if (this.outgoing) {
                    this.$el.addClass('outgoing');
                }
            }
            return this;
        },

        remove: function() {
            this.unbindStream();
            this.unbindPeer();
            return F.View.prototype.remove.call(this);
        },

        getPopup: function() {
            // The popup gets moved around, so we need to find it where it may live.
            let $popup = this.$('.ui.popup');
            if (!$popup.length) {
                $popup = this.$el.closest('.f-call-view').children(`.ui.popup[data-id="${this.userId}"]`);
            } 
            return $popup;
        },

        togglePinned: function(pinned) {
            pinned = pinned === undefined ? !this.isPinned() : pinned !== false;
            this.$el.toggleClass('pinned', pinned);
            this.getPopup().toggleClass('pinned', pinned);
            this.trigger('pinned', this, pinned);
        },

        toggleSilenced: function(silenced) {
            silenced = silenced === undefined ? !this.isSilenced() : silenced !== false;
            this.$el.toggleClass('silenced', !!silenced);
            this.getPopup().toggleClass('silenced', !!silenced);
            if (this.stream) {
                for (const track of this.stream.getAudioTracks()) {
                    track.enabled = !silenced;
                }
            }
            this.trigger('silenced', this, silenced);
        },

        toggleDisabled: function(disabled) {
            disabled = disabled === undefined ? !this.isDisabled() : disabled !== false;
            this.$el.toggleClass('disabled', disabled);
            this.getPopup().toggleClass('disabled', disabled);
            this.trigger('disabled', this, disabled);
        },

        restart: function() {
            this.unbindStream();
            this.unbindPeer();
            // We can't actually manage the RTC connection from here.
            // Send happens via CallView listener...
            this.trigger('restart', this);
        },

        stop: function(options) {
            options = options || {};
            this.unbindStream({silent: options.silent});
            this.unbindPeer();
            this.setStatus(options.status);
        },

        setStatus: function(status) {
            status = status || '';
            this.getPopup().find('.f-status').text(status);
            this._status = status;
            const $circle = this.$('.f-status-circle');
            const addClass = $circle.data(status.toLowerCase() || 'empty');
            F.assert(addClass !== undefined, `Missing status bubble data attr for: ${status}`);
            $circle.attr('class', $circle.data('baseClass') + ' ' + addClass);
            $circle.attr('title', status);
            this.statusChanged = Date.now();
            this.trigger('statuschanged', this, status);
        },

        getStatus: function() {
            return this._status;
        },

        setStreaming: function(streaming, options) {
            streaming = streaming !== false;
            options = options || {};
            this.$el.toggleClass('streaming', streaming);
            if (!this.outgoing && !options.silent) {
                const clip = streaming ? '/audio/call-peer-join.ogg' : '/audio/call-leave.ogg';
                F.util.playAudio(clip);  // bg okay
            }
            this.trigger('streaming', this, streaming);
        },

        isStreaming: function() {
            return this.$el.hasClass('streaming');
        },

        isPinned: function() {
            return this.$el.hasClass('pinned');
        },

        isSilenced: function() {
            return this.$el.hasClass('silenced');
        },

        isDisabled: function() {
            return this.$el.hasClass('disabled');
        },

        bindStream: function(stream, options) {
            stream = stream || this.stream;
            options = options || {};
            F.assert(stream instanceof MediaStream);
            if (stream !== this.stream) {
                this.unbindStream();
                this.stream = stream;
            }
            const silenced = this.isSilenced();
            let hasAudio = false;
            let hasVideo = false;
            for (const track of stream.getTracks()) {
                this.stopTrackListeners(track);  // need to debounce
                this.startTrackListeners(track);
                if (track.kind === 'audio' && silenced) {
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
            this.$('video')[0].srcObject = hasMedia ? this.stream : null;  // XXX Possibly an optimization we don't need
            this.trigger('bindstream', this, this.stream);
            let streaming = false;
            if (this.outgoing) {
                streaming = hasMedia;
            } else if (this.peer) {
                streaming = hasMedia && isPeerConnectState(this.peer.iceConnectionState);
            }
            this._lastState = this.peer ? this.peer.iceConnectionState : null;
            if (streaming) {
                this.setStreaming(true, {silent: options.silent});
            }
        },

        unbindStream: function(options) {
            options = options || {};
            if (this.isStreaming()) {
                this.setStreaming(false, {silent: options.silent});
            }
            if (this.soundMeter) {
                this.soundMeter.disconnect();
                this.soundMeter = null;
                this.soundLevel = -1;
            }
            if (this.stream) {
                for (const track of this.stream.getTracks()) {
                    this.stopTrackListeners(track);
                    track.stop();
                }
            }
            this._lastState = null;
            this.stream = null;
            this.$('video')[0].srcObject = null;
            this.trigger('bindstream', this, null);
        },

        bindPeer: function(peer) {
            F.assert(peer instanceof RTCPeerConnection);
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

        _onTrackOverconstrained: function(ev) {
            console.warn("TRACK Overconstrained");
            debugger;
        },

        _onPeerICEConnectionStateChange: function(ev) {
            const state = ev.target.iceConnectionState;
            try {
                console.debug(`Peer ICE connection: ${this._lastState} -> ${state}`, this.userId);
                const hasMedia = !!(this.stream && this.stream.getTracks().length);
                const streaming = hasMedia && isPeerConnectState(state);
                if (streaming && !this.isStreaming()) {
                    this.setStreaming(true);
                } else if (!streaming && this.isStreaming()) {
                    this.setStreaming(false);
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
    });


    F.CallPresenterView = F.View.extend({

        template: 'views/call-presenter.html',
        className: 'f-call-presenter-view',

        events: {
            'click .f-pin': 'onPinClick',
            'click .f-restart': 'onRestartClick',
            'click .f-silence': 'onSilenceClick',
        },

        render_attributes: async function() {
            if (!this.memberView) {
                return {};
            }
            const user = await F.atlas.getContact(this.memberView.userId);
            return {
                id: user.id,
                tagSlug: user.getTagSlug(),
                avatar: await user.getAvatar({
                    size: 'large',
                    allowMultiple: true
                }),
                outgoing: this.memberView.outgoing,
                status: this.memberView.getStatus()
            };
        },

        select: async function(view) {
            F.assert(view instanceof F.CallMemberView);
            if (view !== this.memberView) {
                if (this.memberView) {
                    this.stopListening(this.memberView, 'bindstream');
                    this.stopListening(this.memberView, 'streaming');
                    this.stopListening(this.memberView, 'pinned');
                    this.stopListening(this.memberView, 'silenced');
                    this.stopListening(this.memberView, 'disabled');
                    this.stopListening(this.memberView, 'statuschanged');
                }
                this.memberView = view;
                this.listenTo(view, 'bindstream', this.onMemberBindStream);
                this.listenTo(view, 'streaming', this.onMemberStreaming);
                this.listenTo(view, 'pinned', this.onMemberPinned);
                this.listenTo(view, 'silenced', this.onMemberSilenced);
                this.listenTo(view, 'disabled', this.onMemberDisabled);
                this.listenTo(view, 'statuschanged', this.onMemberStatusChanged);
            }
            this.$el.toggleClass('streaming', view.isStreaming());
            this.$el.toggleClass('silenced', view.isSilenced());
            this.$el.toggleClass('pinned', view.isPinned());
            this.$el.toggleClass('disabled', view.isDisabled());
            await this.render();
            this.$('video')[0].srcObject = view.stream;
        },

        onPinClick: function() {
            this.memberView.togglePinned();
        },

        onSilenceClick: function() {
            this.memberView.toggleSilenced();
        },

        onRestartClick: function() {
            this.memberView.restart();
        },

        onMemberBindStream: function(view, stream) {
            this.$('video')[0].srcObject = stream;
        },

        onMemberStreaming: function(view, streaming) {
            this.$el.toggleClass('streaming', streaming);
        },

        onMemberPinned: function(view, pinned) {
            this.$el.toggleClass('pinned', pinned);
        },

        onMemberSilenced: function(view, silenced) {
            this.$el.toggleClass('silenced', silenced);
        },

        onMemberDisabled: function(view, disabled) {
            this.$el.toggleClass('disabled', disabled);
        },

        onMemberStatusChanged: function(view, value) {
            this.$('.f-status').text(value);
        }
    });


    F.CallSettingsView = F.ModalView.extend({
        contentTemplate: 'views/call-settings.html',
        extraClass: 'f-call-settings-view',
        size: 'tiny',
        header: 'Call Settings',
        icon: 'settings',
        scrolling: false,
        allowMultiple: true,

        bpsMin: 56 * 1024,
        bpsMax: 5 * 1024 * 1024,

        events: {
            'input .f-bitrate-limit input': 'onBpsInput',
            'change .f-bitrate-limit input': 'onBpsChange',
        },

        initialize: function(options) {
            this.callView = options.callView;
            F.ModalView.prototype.initialize.apply(this, arguments);
        },

        render_attributes: async function() {
            const settings = await F.state.getDict([
                'callIngressBps',
                'callEgressBps',
                'callVideoResolution',
                'callVideoFacing',
            ]);
            return Object.assign({
                bpsMin: this.bpsMin,
                bpsMax: this.bpsMax,
                ingressPct: this.bpsToPercent(settings.callIngressBps || this.bpsMax),
                egressPct: this.bpsToPercent(settings.callEgressBps || this.bpsMax),
            }, await F.ModalView.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            await F.ModalView.prototype.render.apply(this, arguments);
            // Update labels...
            for (const el of this.$('.f-bitrate-limit input')) {
                this.onBpsInput(null, $(el));
            }
            this.$('.f-video-res .ui.dropdown').dropdown({
                onChange: this.onVideoResChange.bind(this)
            }).dropdown('set selected', await F.state.get('callVideoResolution', 'auto'));
            return this;
        },

        bpsToPercent: function(bps) {
            bps = Math.min(this.bpsMax, Math.max(this.bpsMin, bps));
            const bpsRange = this.bpsMax - this.bpsMin;
            return (bps - this.bpsMin) / bpsRange;
        },

        percentToBps: function(pct) {
            pct = Math.min(1, Math.max(0, pct));
            const bpsRange = this.bpsMax - this.bpsMin;
            return pct * bpsRange + this.bpsMin;
        },

        onBpsInput: function(ev, $input) {
            $input = $input || $(ev.currentTarget);
            const value = this.percentToBps(Number($input.val()));
            let label;
            if (value === this.bpsMax) {
                label = 'Unlimited';
            } else {
                label = F.tpl.help.humanbits(value) + 'ps';
            }
            $input.siblings('.ui.label').text(label);
        },

        onBpsChange: async function(ev) {
            const inputEl = ev.currentTarget;
            const value = this.percentToBps(Number(inputEl.value));
            const stateKey = inputEl.dataset.direction === 'ingress' ? 'callIngressBps' : 'callEgressBps';
            await F.state.put(stateKey, value === this.bpsMax ? undefined : value);
            this._changed = true;
        },

        onVideoResChange: async function(value) {
            await F.state.put('callVideoResolution', value);
            this._changed = true;
        },

        onHidden: async function() {
            if (this._changed) {
                this.callView.outView.stream.getVideoTracks().map(x => x.stop());
                this.callView.outView.bindStream(await this.callView.getOutStream());
                if (this.callView.isJoined()) {
                    this.callView.join({silent: true, restart: true});  // bg okay
                }
            }
            await F.ModalView.prototype.onHidden.apply(this, arguments);
        },
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
