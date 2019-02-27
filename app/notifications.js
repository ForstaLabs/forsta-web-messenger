// vim: ts=4:sw=4:expandtab
/* global firebase md5 Backbone relay */

(function() {
    'use strict';

    self.F = self.F || {};

    F.notifications = new (Backbone.Collection.extend({

        defaultSetting: 'message',
        defaultFilter: ['dm', 'mention', 'name'],

        initialize: function() {
            this.on('add', this.onAdd);
            this.on('remove', this.onRemove);
            if (self.registration && self.clients) {
                addEventListener('notificationclick', this.onClickHandler.bind(this));
                this.worker = true;
            } else {
                this.worker = false;
            }
        },

        havePermission: function() {
            return self.Notification && Notification.permission === 'granted';
        },

        onAdd: async function(model, collection, options) {
            this.trigger('adding', model);
            const message = model.get('message');
            const setting = await F.state.get('notificationSetting') || this.defaultSetting;
            const filters = await F.state.get('notificationFilter') || this.defaultFilter;
            let worthy = !filters.length;
            for (const x of filters) {
                if (x === 'mention') {
                    const mentions = message.get('mentions') || [];
                    if (mentions.indexOf(F.currentUser.id) !== -1) {
                        worthy = true;
                        break;
                    }
                } else if (x === 'name') {
                    const msgText = (message.get('plain') || '').toLowerCase();
                    const fName = (F.currentUser.get('first_name') || '').toLowerCase();
                    const lName = (F.currentUser.get('last_name') || '').toLowerCase();
                    if (msgText.indexOf(fName) + msgText.indexOf(lName) !== -2) {
                        worthy = true;
                        break;
                    }
                } else if (x === 'dm') {
                    if (message.get('members').length === 2) {
                        worthy = true;
                        break;
                    }
                }
            }
            if (setting === 'off' || !this.havePermission() || !worthy) {
                console.debug("Notification muted:", message);
                this.trigger('addstop', model, 'muted');
                return;
            }

            // Alert state needs to be pre debounce.
            const shouldAlert = this.where({threadId: message.get('threadId')}).length == 1;
            await relay.util.sleep(2);  // Allow time for read receipts
            if (!this.isValid(model)) {
                this.trigger('addstop', model, 'invalid');
                return; // 1 of 2  (avoid work)
            }
            let title;
            const note = {
                requireInteraction: true,
                silent: !shouldAlert || await F.state.get('notificationSoundMuted'),
                actions: [{
                    title: 'Dismiss',
                    action: 'dismiss'
                }, {
                    title: 'Mark Read',
                    action: 'markread'
                }]
            };
            if (setting === 'count') {
                title = [
                    this.length,
                    this.length === 1 ? 'New Message' : 'New Messages'
                ].join(' ');
            } else {
                const sender = await message.getSender();
                title = sender.getName();
                note.tag = message.get('threadId');
                note.icon = await sender.getAvatarURL();
                if (setting === 'name') {
                    note.body = 'New Message';
                } else if (setting === 'message') {
                    note.body = message.getNotificationText();
                } else {
                    throw new Error("Invalid setting");
                }
            }
            /* Do final dedup checks after all async calls to avoid races. */
            if (!this.isValid(model.id)) {
                this.trigger('addstop', model, 'invalid');
                return; // 2 of 2  (avoid async races)
            }
            const legacyNotification = await this.show(title, note);
            if (legacyNotification) {
                legacyNotification.addEventListener('click', this.onClickHandler.bind(this));
                legacyNotification.addEventListener('show', this.onShowHandler.bind(this, model.id));
                model.set("note", legacyNotification);
            }
            this.trigger('added', model);
        },

        getSWReg: function() {
            return self.registration || (!F.electron && F.serviceWorkerManager &&
                                         F.serviceWorkerManager.getRegistration());
        },

        isValid: function(id) {
            /* True if the message has not been read yet. */
            return !!this.get(id);
        },

        onClickHandler: function(ev) {
            if (this.worker) {
                ev.waitUntil(this.onClick(ev.notification, ev.action));
            } else {
                this.onClick(ev.target, ev.action);
            }
        },

        onShowHandler: function(id, ev) {
            /* Handle race conditions related to notification rendering. */
            if (!this.isValid(id)) {
                ev.target.close();
            }
        },

        onClick: async function(note, action) {
            note.close();
            if (action === 'dismiss') {
                return;
            } else if (action === 'markread') {
                if (this.worker) {
                    const wins = await F.activeWindows();
                    if (wins.length) {
                        wins[0].postMessage({
                            op: 'clearUnread',
                            data: {
                                threadId: note.tag
                            }
                        });
                    } else {
                        await F.workerReady();
                        const thread = F.foundation.allThreads.get(note.tag);
                        if (thread) {
                            await thread.clearUnread();
                        }
                    }
                }
                return;
            }
            if (F.electron) {
                F.electron.showWindow();
            }
            if (this.worker) {
                let url;
                let threadId;
                if (note.tag.startsWith('call:')) {
                    const encodedData = encodeURIComponent(btoa(JSON.stringify(note.data.data)));
                    threadId = note.data.threadId;
                    url = `${F.urls.main}/${threadId}?call&sender=${note.data.sender}` +
                          `&device=${note.data.device}&data=${encodedData}`;
                } else {
                    threadId = note.tag;
                    url = `${F.urls.main}/${threadId}`;
                }
                const wins = await F.activeWindows();
                if (!wins.length) {
                    console.info("Opening fresh window from notification");
                    await self.clients.openWindow(url);
                } else {
                    console.info("Focus existing window from notification");
                    /* The order is based on last focus for modern browsers */
                    await wins[0].focus();
                    wins[0].postMessage({
                        op: 'openThread',
                        data: {
                            threadId: note.tag
                        }
                    });
                }
            } else {
                parent.focus();
                F.mainView.openThreadById(note.tag);
            }
            this.remove(this.where({threadId: note.tag}));
        },

        onRemove: async function(model, collection, options) {
            const note = model.get('note');
            if (note) {
                note.close();
            } else {
                const swReg = this.getSWReg();
                if (swReg) {
                    const notes = await swReg.getNotifications({tag: model.get('threadId')});
                    for (const n of notes) {
                        n.close();
                    }
                }
            }
        },

        show: async function(title, note) {
            // Apply some defaults and compat for showing a basic notification.  Safe for external
            // use too.
            note = Object.assign({
                sound: 'audio/new-notification.mp3',
                silent: false,
                icon: F.util.versionedURL(F.urls.static + 'images/logo_metal_bg_256.png'),
                badge: F.util.versionedURL(F.urls.static + 'images/icon_128.png'),
                tag: 'forsta'
            }, note);
            const sound = !note.silent && note.sound;
            delete note.sound;  // Use our own audio support.
            if (sound) {
                await F.util.playAudio(sound);
            }
            const swReg = this.getSWReg();
            if (swReg) {
                await swReg.showNotification(title, note);
            } else {
                return new Notification(title, note);
            }
        },

        showCall: async function(originator, sender, device, threadId, data) {
            // Note this only works for service worker enabled browsers.
            if (!this.worker) {
                throw new Error("showCall only works with modern browsers");
            }
            return await this.show(`Incoming call from ${originator.getName()}`, {
                icon: await originator.getAvatarURL(),
                sound: 'audio/call-ring.mp3',
                tag: `call:${data.callId}`,
                data: {threadId, sender, device, data},
                body: 'Click to accept call.',
                renotify: true,
                vibrate: [100, 100, 100, 100, 100, 100]
            });
        }
    }))();


    F.BackgroundNotificationService = class BackgroundNotificationService {

        async start() {
            if (!('serviceWorker' in navigator && F.env.FIREBASE_CONFIG)) {
                return false;
            }
            const fb = firebase.initializeApp(F.env.FIREBASE_CONFIG,
                                              'push-notifications-' + F.currentUser.id);
            this.fbm = firebase.messaging(fb);
            F.serviceWorkerManager.addEventListener('bindregistration', this.bindFbm.bind(this));
            const reg = F.serviceWorkerManager.getRegistration();
            if (reg) {
                await this.bindFbm(reg);
            }
        }

        async bindFbm(reg) {
            this.fbm.useServiceWorker(reg);
            await this.setupToken();
        }

        async isKnownToken(token) {
            /* Check if server has the token in question. */
            const curHash = await F.state.get('serverGcmHash');
            return curHash === md5(token);
        }

        async saveKnownToken(token) {
            if (token) {
                await F.state.put('serverGcmHash', md5(token));
            } else {
                await F.state.remove('serverGcmHash');
            }
        }

        async shareTokenWithSignal(token) {
            console.info("Updating GCM Registration ID");
            const am = await F.foundation.getAccountManager();
            try {
                await am.signal.updateGcmRegistrationId(token);
            } catch(e) {
                await this.saveKnownToken(null);
                throw e;
            }
            await this.saveKnownToken(token);
        }

        async setupToken() {
            /* Loads or creates a messaging token used by Signal server to find us.
             * Also establishes a monitor in case the token changes. */
            const token = await this.fbm.getToken();
            if (token) {
                if (!(await this.isKnownToken(token))) {
                    await this.shareTokenWithSignal(token);
                }
            } else {
                throw new Error("Did not get token for FBM; Permissions granted?");
            }
            this.fbm.onTokenRefresh(async function() {
                console.info('Firebase messaging token refreshed.');
                await this.shareTokenWithSignal(await this.fbm.getToken());
            });
        }
    };
})();
