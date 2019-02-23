// vim: ts=4:sw=4:expandtab
/* global relay, platform, chrome, moment */

(function () {
    'use strict';

    self.F = self.F || {};

    const canFullscreen = document.fullscreenEnabled ||
                          document.mozFullScreenEnabled ||
                          document.webkitFullscreenEnabled;
    const canPopout = document.pictureInPictureEnabled;
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

    function limitSDPBandwidth(desc, bandwidth) {
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
    }

    F.CallView = F.ModalView.extend({

        template: 'views/call.html',
        className: 'f-call-view ui modal',
        closable: false,  // Prevent accidents and broken fullscreen behavior in safari.

        initialize: function(options) {
            F.assert(options.iceServers);
            F.assert(options.manager);
            this.manager = options.manager;
            this.iceServers = options.iceServers;
            this.forceScreenSharing = options.forceScreenSharing;
            this.offeringPeers = new Map();
            this.memberViews = new Map();
            this.outView = this.addMemberView(F.currentUser.id, F.currentDevice);
            this.outView.toggleSilenced(true);
            this.on('peerjoin', this.onPeerJoin);
            this.on('peericecandidates', this.onPeerICECandidates);
            this.on('peeroffer', this.onPeerOffer);
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
            'click .f-start-leave-call.button:not(.loading)': 'onStartLeaveClick',
            'click .f-video.mute.button': 'onVideoMuteClick',
            'click .f-audio.mute.button': 'onAudioMuteClick',
            'click .f-detach.button': 'onDetachClick',
            'click .f-fullscreen.button': 'onFullscreenClick',
            'click .f-close.button': 'onCloseClick',
            'pointerdown > .header': 'onHeaderPointerDown',
        },

        render_attributes: function() {
            return {
                thread: this.model,
                canFullscreen,
                canPopout,
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
                this.presenterView = await new F.CallPresenterView({callView: this});
                this.$('.f-presenter').append(this.presenterView.$el);
                for (const view of this.getMemberViews()) {
                    this.$('.f-audience').append(view.$el);
                }
                await this.selectPresenter(this.outView);
            } else {
                for (const view of this.getMemberViews()) {
                    await view.render();
                }
                await this.presenterView.select(this._presenting);
            }
            return this;
        },

        setOutStream: function(stream) {
            this.outStream = stream;
            if (this.outView) {
                this.outView.bindStream(stream);
            }
        },

        getMemberView: function(userId, device) {
            const addr = `${userId}.${device}`;
            return this.memberViews.get(addr);
        },

        getMemberViews: function() {
            return Array.from(this.memberViews.values());
        },

        findMemberViews: function(userId) {
            const results = [];
            for (const [key, value] of this.memberViews.entries()) {
                if (key.startsWith(userId)) {
                    results.push(value);
                }
            }
            return results;
        },

        addMemberView: function(userId, device) {
            const addr = `${userId}.${device}`;
            F.assert(!this.memberViews.has(addr));
            const order = (this.manager.members.findIndex(x => x.id === userId) << 16) + (device & 0xffff);
            const view = new F.CallMemberView({userId, device, order, callView: this});
            view.on('pinned', this.onMemberPinned.bind(this));
            if (view.outgoing) {
                view.on('silenced', this.onOutgoingMemberSilenced.bind(this));
            }
            this.memberViews.set(addr, view);
            this.$('.f-audience').append(view.$el);  // Might be noop if not rendered yet, which is fine.
            view.render();  // bg okay
            return view;
        },

        removeMemberView: function(view) {
            const id = `${view.userId}.${view.device}`;
            F.assert(view === this.memberViews.get(id));
            this.memberViews.delete(id);
            view.remove();
        },

        setCallStatus: function(value) {
            this.$('.f-call-status').html(value);
        },

        setStarted: function(started) {
            started = started !== false;
            if (started) {
                this._started = this._started || Date.now();
            } else {
                this._left = this._left || Date.now();
            }
            this.$el.toggleClass('started', started);
            this.$('.f-start-leave-call.button').toggleClass('active', !started);
        },

        start: async function(options) {
            options = options || {};
            if (this._starting) {
                console.warn("Ignoring start request: already starting");
                return;
            }
            this._starting = true;
            try {
                await this.manager.join();
                this.setStarted(true);
            } finally {
                this._starting = false;
            }
        },

        leave: async function() {
            if (!this.isStarted() || this._leaving) {
                console.warn("Ignoring leave request: already left/leaving or not started");
                return;
            }
            this._leaving = true;
            try {
                await this.manager.leave();
                for (const view of this.getMemberViews()) {
                    if (view.outgoing) {
                        continue;
                    }
                    this.removeMemberView(view);
                }
                this.setStarted(false);
            } finally {
                this._leaving = false;
            }
        },

        remove: function() {
            clearInterval(this._soundCheckInterval);
            this._soundCheckInterval = null;
            this.leave();
            for (const fullscreenchange of ['mozfullscreenchange', 'webkitfullscreenchange']) {
                document.removeEventListener(fullscreenchange, this._onFullscreenChange);
            }
            if (this._started) {
                if (!this._left) {
                    this._left = Date.now();
                }
                const elapsed = moment.duration(this._left - this._started);
                this.model.createMessage({
                    type: 'clientOnly',
                    plain: `You were in a call for ${elapsed.humanize()}.`
                });
            }
            return F.ModalView.prototype.remove.call(this);
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
            const memberViews = new Set(this.getMemberViews());
            memberViews.delete(this.outView);
            let loudest;
            if (memberViews.size === 0) {
                loudest = this.outView;
            } else if (memberViews.size === 1) {
                loudest = Array.from(memberViews)[0];
            } else {
                loudest = this._presenting !== this.outView ? this._presenting : null;
                for (const view of memberViews) {
                    if (!loudest || view.soundLevel - loudest.soundLevel >= 0.01) {
                        loudest = view;
                    }
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
            if (this._presenting) {
                this._presenting.togglePresenting(false);
            }
            this._presenting = view;
            view.togglePresenting(true);
            await this.presenterView.select(view);
        },

        makePeerConnection: function(peerId) {
            const peer = new RTCPeerConnection({iceServers: this.iceServers});
            peer._id = peerId;  // Not to be confused with the peerIdentity spec prop.
            for (const track of this.outStream.getTracks()) {
                peer.addTrack(track, this.outStream);
            }
            return peer;
        },

        isStarted: function() {
            return this.$el.hasClass('started');
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

        onPeerOffer: async function(userId, device, data) {
            F.assert(data.callId === this.manager.callId);
            F.assert(!this.getMemberView(userId, device));
            const id = `${userId}.${device}`;
            console.info('Peer sent us a call-offer:', id);
            if (this.getMemberView(userId, device)) {
                console.error("XXX peer offer for existing peer, decide what to do, probably" +
                              " remove the old one and start a new view.");
                return;
            }
            const view = this.addMemberView(userId, device);
            await view.acceptOffer(data);
        },

        onPeerAcceptOffer: function(userId, device, data) {
            F.assert(data.callId === this.manager.callId);
            const view = this.getMemberView(userId, device);
            if (!view) {
                console.error(`Peer accept offer from non-member: ${userId}.${device}`); 
                return;
            }
            view.handlePeerAcceptOffer(data);
            F.util.playAudio('/audio/call-peer-join.ogg');  // bg okay
        },

        onPeerICECandidates: async function(userId, device, data) {
            F.assert(data.callId === this.manager.callId);
            F.assert(data.peerId);
            const id = `${userId}.${device}`;
            const view = this.getMemberView(userId, device);
            const peer = view && view.peer;
            if (!peer || peer._id !== data.peerId) {
                console.error("Dropping ICE candidates for peer connection we don't have:", data.peerId, id);
                return;
            }
            console.debug(`Adding ${data.icecandidates.length} ICE candidate(s) for:`, id);
            await Promise.all(data.icecandidates.map(x => peer.addIceCandidate(new RTCIceCandidate(x))));
        },

        onPeerJoin: async function(userId, device) {
            const addr = `${userId}.${device}`;
            if (!this.isStarted()) {
                console.warn("Dropping peer-join while not started:", addr);
                return;
            }
            console.info('Peer is joining call:', addr);
            const view = this.getMemberView(userId, device) || this.addMemberView(userId, device);
            await view.sendOffer();
        },

        onPeerLeave: async function(userId, device) {
            const addr = `${userId}.${device}`;
            const view = this.getMemberView(userId, device);
            if (!view) {
                console.warn("Dropping peer-leave from detached peer:", addr);
                return;
            }
            console.warn('Peer left call:', addr);
            this.removeMemberView(view);
            F.util.playAudio('/audio/call-leave.ogg');  // bg okay
        },

        onStartLeaveClick: async function() {
            //const dialSound = await F.util.playAudio('/audio/call-dial.ogg');  // bg okay
            const $button = this.$('.f-start-leave-call.button');
            $button.addClass('loading');
            try {
                if (this.isStarted()) {
                    await this.leave();
                    F.util.playAudio('/audio/call-leave.ogg');  // bg okay
                } else {
                    F.util.playAudio('/audio/call-dial.ogg');  // bg okay
                    await this.start();
                }
            } finally {
                $button.removeClass('loading');
            }
        },

        onVideoMuteClick: function(ev) {
            if (!this.outStream) {
                console.warn("No outgoing stream to mute");
            }
            const mute = !this.$el.hasClass('video-muted');
            this.$el.toggleClass('video-muted', mute);
            for (const track of this.outStream.getVideoTracks()) {
                track.enabled = !mute;
            }
        },

        onAudioMuteClick: function(ev) {
            if (!this.outStream) {
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
                await F.util.exitFullscreen();
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
            console.log('fs el', document.fullscreenElement, this.isFullscreen(), this._fullscreenActive);
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
            const offsetX = ev.pageX - this.el.offsetLeft;
            const offsetY = ev.pageY - this.el.offsetTop;
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
            for (const x of Array.from(this.outStream.getVideoTracks())) {
                this.outStream.removeTrack(x);
                x.stop();
            }
            this.outStream.addTrack(track);
            this.outView.bindStream(this.outStream);  // Recalc info about our new track.
            const outStreamClosure = this.outStream;
            track.addEventListener('ended', async () => {
                if (this.outStream !== outStreamClosure) {
                    console.warn("Ignoring track ended event for stale outStream");
                    return;
                }
                this.outStream.removeTrack(track);
                let videoTrack;
                if (this.forceScreenSharing) {
                    videoTrack = getDummyVideoTrack();
                } else {
                    const replacementStream = await this.getOutStream({videoOnly: true});
                    const videoTracks = replacementStream.getVideoTracks();
                    F.assert(videoTracks.length === 1);
                    videoTrack = videoTracks[0];
                }
                this.outStream.addTrack(videoTrack);
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

        onOutgoingMemberSilenced: async function(view, silenced) {
            this.$el.toggleClass('audio-muted', silenced);
        }
    });


    F.CallMemberView = F.View.extend({

        template: 'views/call-member.html',
        className: 'f-call-member-view',

        events: {
            'click': 'onClick'
        },

        initialize: function(options) {
            F.assert(options.userId);
            F.assert(options.device);
            F.assert(options.callView);
            this.userId = options.userId;
            this.device = options.device;
            this.addr = `${this.userId}.${this.device}`;
            this.callView = options.callView;
            this.soundLevel = -1;
            this.outgoing = this.userId === F.currentUser.id && this.device === F.currentDevice;
            this.order = this.outgoing ? -1 : options.order;
            F.assert(this.order != null);
            F.View.prototype.initialize(options);
        },

        render_attributes: async function() {
            const user = await F.atlas.getContact(this.userId);
            return {
                name: user.getName(),
                tagSlug: user.getTagSlug(),
                avatar: await user.getAvatar({
                    size: 'large',
                    allowMultiple: true
                }),
                outgoing: this.outgoing,
            };
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.videoEl = this.$('video')[0];
            this.$el.css('order', this.order).toggleClass('outgoing', this.outgoing);
            this.bindStream(this.stream);
            return this;
        },

        remove: function() {
            this.unbindPeer();
            return F.View.prototype.remove.call(this);
        },

        onClick: function() {
            this.togglePinned(true);
        },

        togglePinned: function(pinned) {
            pinned = pinned === undefined ? !this.isPinned() : pinned !== false;
            this.$el.toggleClass('pinned', !!pinned);
            this.trigger('pinned', this, pinned);
        },

        toggleSilenced: function(silenced) {
            silenced = silenced === undefined ? !this.isSilenced() : silenced !== false;
            this.$el.toggleClass('silenced', !!silenced);
            if (this.stream) {
                for (const track of this.stream.getAudioTracks()) {
                    track.enabled = !silenced;
                }
            }
            this.trigger('silenced', this, silenced);
        },

        togglePresenting: function(presenting) {
            this.$el.toggleClass('presenting', presenting);
        },

        restart: async function() {
            this.unbindPeer();
            await this.sendOffer();
        },

        stop: function(options) {
            options = options || {};
            this.unbindPeer();
            this.setStatus(options.status);
        },

        setStatus: function(status) {
            status = status || '';
            this._status = status;
            if (this._rendered) {
                const $circle = this.$('.f-status-circle');
                const addClass = $circle.data(status.toLowerCase() || 'empty');
                F.assert(addClass !== undefined, `Missing status bubble data attr for: ${status}`);
                $circle.attr('class', $circle.data('baseClass') + ' ' + addClass);
                $circle.attr('title', status);
            }
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

        sendPeerControl: async function(control, data) {
            await this.callView.manager.sendControlToDevice(control, this.addr, data);
        },

        isConnected: function() {
            return this.peer && isPeerConnectState(this.peer.iceConnectionState);
        },

        bindStream: function(stream) {
            F.assert(stream == null || stream instanceof MediaStream);
            this.stream = stream;
            if (!stream) {
                this._unbindStream();
                return;
            }
            const silenced = this.isSilenced();
            let hasAudio = false;
            let hasVideo = false;
            for (const track of stream.getTracks()) {
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
            this.soundLevel = -1;
            let soundMeter;
            if (hasAudio) {
                if (!this.soundMeter || this.soundMeter.src.mediaStream !== stream) {
                    if (this.soundMeter) {
                        this.soundMeter.disconnect();
                    }
                    soundMeter = new SoundMeter(stream, levels => {
                        // The disconnect is not immediate, so we need to check that we are still
                        // the wired sound meter.
                        if (this.soundMeter === soundMeter) {
                            this.soundLevel = levels.average;
                        }
                    });
                } else {
                    soundMeter = this.soundMeter;  // no change
                }
            } else if (this.soundMeter) {
                this.soundMeter.disconnect();
            }
            this.soundMeter = soundMeter;
            if (this.videoEl) {
                this.videoEl.srcObject = hasMedia ? this.stream : null;
            }
            this.trigger('bindstream', this, this.stream);
            let streaming = false;
            if (this.outgoing) {
                streaming = hasMedia;
            } else if (this.peer) {
                streaming = hasMedia && this.isConnected();
            }
            this._lastState = this.peer ? this.peer.iceConnectionState : null;
            this.setStreaming(streaming);
        },

        _unbindStream: function(options) {
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
                    track.stop();
                }
            }
            this._lastState = null;
            this.stream = null;
            if (this.videoEl) {
                this.videoEl.srcObject = null;
            }
            this.trigger('bindstream', this, null);
        },

        bindPeer: function(peer) {
            F.assert(peer instanceof RTCPeerConnection);
            F.assert(!this.peer, 'View already bound to peer');
            this.peer = peer;
            this._peerListeners = {
                // NOTE: eventually we should switch to connectionstatechange when browser
                // support becomes available.  Right now chrome doesn't have it, maybe others.
                // Also don't trust MDN on this, they wrongly claim it is supported since M56.
                iceconnectionstatechange: ev => {
                    if (this.peer !== peer) {
                        console.error("Dropping stale peer iceconnectionstatechange event:", this.addr);
                        return;
                    }
                    const state = ev.target.iceConnectionState;
                    try {
                        console.debug(`Peer ICE connection: ${this._lastState} -> ${state}`, this.addr);
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

                icecandidate: F.buffered(async eventArgs => {
                    if (this.peer !== peer) {
                        console.error("Dropping stale peer icecandidate event:", this.addr);
                        return;
                    }
                    const icecandidates = eventArgs.map(x => x[0].candidate).filter(x => x);
                    console.warn(`Sending ${icecandidates.length} ICE candidate(s) to: ${this.addr}`);
                    await this.sendPeerControl('callICECandidates', {icecandidates, peerId: peer._id});
                }, 200, {max: 600}),

                track: ev => {
                    // Firefox will sometimes have more than one media stream but they
                    // appear to always be the same stream. Strange.
                    if (this.peer !== peer) {
                        console.error("Dropping stale peer track event:", this.addr);
                        return;
                    }
                    const stream = ev.streams[0];
                    if (stream !== this.stream) {
                        console.info("Binding new media stream:", this.addr);
                    }
                    // Be sure to call everytime so we are aware of all tracks.
                    // Using MediaStream.onaddtrack does not work as expected.
                    this.bindStream(stream);
                },

                negotiationneeded: ev => {
                    console.warn("NEG NEEDED", ev); // XXX check to see if offer already sent, if so, send another
                }
            };
            for (const [event, listener] of Object.entries(this._peerListeners)) {
                peer.addEventListener(event, listener);
            }
        },

        unbindPeer: function() {
            this._unbindStream();
            if (this.peer) {
                const peer = this.peer;
                const listeners = this._peerListeners;
                this.peer = null;
                this._peerListeners = null;
                for (const [event, listener] of Object.entries(listeners)) {
                    peer.removeEventListener(event, listener);
                }
                peer.close();
            }
        },

        sendOffer: async function() {
            await F.queueAsync(`call-send-offer-${this.addr}`, async () => {
                F.assert(!this._pendingPeer, 'Offer already sent to this user');
                this.setStatus();
                let peer;
                if (this.peer) {
                    console.warn(`Reusing existing peer connection for new offer: ${this.addr}`);
                    peer = this.peer;
                } else {
                    peer = this.callView.makePeerConnection(F.util.uuid4());
                    this._pendingPeer = peer;
                }
                const offer = limitSDPBandwidth(await peer.createOffer(), await F.state.get('callIngressBps'));
                await peer.setLocalDescription(offer);
                this.setStatus('Calling');
                const called = this.statusChanged;
                console.info("Sending offer to:", this.addr);
                await this.sendPeerControl('callOffer', {offer, peerId: peer._id});
                relay.util.sleep(30).then(() => {
                    if (this.statusChanged === called) {
                        this.setStatus('Unavailable');
                    }
                });
            });
        },

        acceptOffer: async function(data) {
            await F.queueAsync(`call-accept-offer-${this.addr}`, async () => {
                if (this.peer) {
                    console.warn('Removing stale peer for:', this.addr);
                    this.unbindPeer();
                }
                const peer = this.callView.makePeerConnection(data.peerId);
                this.bindPeer(peer);
                await peer.setRemoteDescription(limitSDPBandwidth(data.offer, await F.state.get('callEgressBps')));
                F.assert(peer.remoteDescription.type === 'offer');
                const answer = limitSDPBandwidth(await peer.createAnswer(), await F.state.get('callIngressBps'));
                await peer.setLocalDescription(answer);
                console.info("Accepting call offer from:", this.addr);
                this.sendPeerControl('callAcceptOffer', {peerId: data.peerId, answer});  // bg okay
            });
            this.callView.setStarted(true);
        },

        handlePeerAcceptOffer: async function(data) {
            const peer = this._pendingPeer || this.peer;
            F.assert(peer, 'Accept-offer for inactive peer');
            F.assert(peer._id === data.peerId, 'Invalid peerId in accept-offer');
            console.info(`Peer accepted our call offer: ${this.addr}`);
            if (this._pendingPeer) {
                this._pendingPeer = null;
                this.bindPeer(peer);
            }
            await peer.setRemoteDescription(limitSDPBandwidth(data.answer, await F.state.get('callEgressBps')));
        },
    });


    F.CallPresenterView = F.View.extend({

        template: 'views/call-presenter.html',
        className: 'f-call-presenter-view',

        initialize: function(options) {
            F.assert(options.callView);
            this.callView = options.callView;
            F.View.prototype.initialize(options);
        },

        render_attributes: async function() {
            if (!this.memberView) {
                return {};
            }
            const user = await F.atlas.getContact(this.memberView.userId);
            return {
                userId: user.id,
                name: user.getName(),
                tagSlug: user.getTagSlug(),
                avatar: await user.getAvatar({
                    size: 'large',
                    allowMultiple: true
                }),
                outgoing: this.memberView.outgoing,
                status: this.memberView.getStatus(),
                canFullscreen,
                canPopout,
            };
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.videoEl = this.$('video')[0];
            this.$('.ui.dropdown').dropdown({
                onChange: this.onDropdownChange.bind(this),
            });
            return this;
        },

        select: async function(view) {
            F.assert(view instanceof F.CallMemberView);
            if (view !== this.memberView) {
                if (this.memberView) {
                    this.stopListening(this.memberView, 'bindstream');
                    this.stopListening(this.memberView, 'streaming');
                    this.stopListening(this.memberView, 'pinned');
                    this.stopListening(this.memberView, 'silenced');
                    this.stopListening(this.memberView, 'statuschanged');
                }
                this.memberView = view;
                this.listenTo(view, 'bindstream', this.onMemberBindStream);
                this.listenTo(view, 'streaming', this.onMemberStreaming);
                this.listenTo(view, 'pinned', this.onMemberPinned);
                this.listenTo(view, 'silenced', this.onMemberSilenced);
                this.listenTo(view, 'statuschanged', this.onMemberStatusChanged);
            }
            await this.render();
            this.videoEl.srcObject = view.stream;
            this.$el.toggleClass('streaming', view.isStreaming());
            this.$el.toggleClass('silenced', view.isSilenced());
            this.$el.toggleClass('pinned', view.isPinned());
        },

        toggleFullscreen: async function() {
            const currentFullscreen = F.util.fullscreenElement();
            if (currentFullscreen) {
                await F.util.exitFullscreen();
                if (currentFullscreen === this.videoEl) {
                    return;
                }
            }
            await F.util.requestFullscreen(this.videoEl);
        },

        togglePopout: async function() {
            if (this.callView.isFullscreen()) {
                await F.util.exitFullscreen();
            }
            if (document.pictureInPictureElement) {
                if (document.pictureInPictureElement === this.videoEl) {
                    await document.exitPictureInPicture();
                    return;
                }
            }
            await this.videoEl.requestPictureInPicture();

        },

        onDropdownChange: function(value) {
            const handlers = {
                silence: this.memberView.toggleSilenced.bind(this.memberView),
                fullscreen: this.toggleFullscreen.bind(this),
                popout: this.togglePopout.bind(this),
            };
            handlers[value].call();
        },

        onMemberBindStream: function(view, stream) {
            if (this.videoEl) {
                this.videoEl.srcObject = stream;
            }
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
            F.assert(options.callView);
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
                debugger; // XXX REVISIT
                this.callView.outStream.getVideoTracks().map(x => x.stop());
                this.callView.setOutStream(await this.callView.getOutStream());
                if (this.callView.isStarted()) {
                    this.callView.start({restart: true});  // bg okay
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
