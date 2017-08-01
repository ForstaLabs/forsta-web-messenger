// vim: ts=4:sw=4:expandtab
/* global WebSocketResource, getString */


(function () {
    'use strict';

    self.textsecure = self.textsecure || {};

    function AccountManager(url, username, password) {
        this.server = new textsecure.TextSecureServer(url, username, password);
        this.preKeyLowWater = 25;  // Add more keys when we get this low.
        this.preKeyHighWater = 100; // Max fill level for prekeys.
    }

    AccountManager.prototype = new textsecure.EventTarget();
    AccountManager.prototype.extend({
        constructor: AccountManager,

        requestVoiceVerification: function(phone) {
            return this.server.requestVerificationVoice(phone);
        },

        requestSMSVerification: function(phone) {
            return this.server.requestVerificationSMS(phone);
        },

        registerSingleDevice: async function(phone, verificationCode) {
            const identityKeyPair = await libsignal.KeyHelper.generateIdentityKeyPair();
            await this.createAccount(phone, verificationCode, identityKeyPair);
            const keys = await this.generateKeys(this.preKeyHighWater);
            await this.server.registerKeys(keys);
            this.registrationDone();
        },

        registerDevice: async function(addr, password, deviceName) {
            const identityKeyPair = await libsignal.KeyHelper.generateIdentityKeyPair();
            const signalingKey = libsignal.crypto.getRandomBytes(32 + 20);
            const registrationId = libsignal.KeyHelper.generateRegistrationId();
            const response = await this.server.addDevice(addr, password, signalingKey,
                registrationId, deviceName);
            const deviceId = response.deviceId;
            const addrId = `${addr}.${deviceId}`;
            const store = textsecure.store;
            await store.clearSessionStore();
            await store.removeOurIdentity();
            const wipestate = ['signalingKey', 'password', 'registrationId',
                'addrId', 'addr', 'deviceId', 'deviceName'];
            await Promise.all(wipestate.map(key => store.removeState(key)));
            // update our own identity key, which may have changed
            // if we're relinking after a reinstall on the master device
            await store.removeIdentityKey(addr);
            await store.saveIdentity(addr, identityKeyPair.pubKey);
            await store.saveOurIdentity(identityKeyPair);
            await store.putStateDict({
                signalingKey,
                password: response.password,
                registrationId,
                deviceName,
                addrId,
                addr,
                deviceId
            });
            this.server.username = addrId;
            this.server.password = response.password;
            const keys = await this.generateKeys(this.preKeyHighWater);
            await this.server.registerKeys(keys);
            this.registrationDone();
        },

        registerSecondDevice: async function(setProvisioningUrl, confirmPhone, progressCallback) {
            const provisioningCipher = new libsignal.ProvisioningCipher();
            const pubKey = await provisioningCipher.getPublicKey();
            const envelope = await new Promise((resolve, reject) => {
                const ws = this.server.getProvisioningSocket();
                ws.onclose = e => reject(new Error('websocket closed'));
                const wsr = new WebSocketResource(ws, {
                    keepalive: {path: '/v1/keepalive/provisioning'},
                    handleRequest: request => {
                        if (request.path === "/v1/address" && request.verb === "PUT") {
                            const proto = textsecure.protobuf.ProvisioningUuid.decode(request.body);
                            const uriPubKey = encodeURIComponent(btoa(getString(pubKey)));
                            setProvisioningUrl(`tsdevice:/?uuid=${proto.uuid}&pub_key=${uriPubKey}`);
                            request.respond(200, 'OK');
                        } else if (request.path === "/v1/message" && request.verb === "PUT") {
                            const envelope = textsecure.protobuf.ProvisionEnvelope.decode(request.body, 'binary');
                            request.respond(200, 'OK');
                            wsr.close();
                            resolve(envelope);
                        } else {
                            reject(new Error('Unknown websocket message ' + request.path));
                        }
                    }
                });
            });
            const provisionMessage = await provisioningCipher.decrypt(envelope);
            const deviceName = await confirmPhone(provisionMessage.addr);
            if (typeof deviceName !== 'string' || deviceName.length === 0) {
                throw new Error('Invalid device name');
            }
            await this.createAccount(provisionMessage.addr, provisionMessage.provisioningCode,
                                     provisionMessage.identityKeyPair, deviceName);
            const keys = await this.generateKeys(this.preKeyHighWater, progressCallback);
            await this.server.registerKeys(keys);
            this.registrationDone();
        },

        refreshPreKeys: async function() {
            const preKeyCount = await this.server.getMyKeys();
            if (preKeyCount <= this.prekeyLowWater) {
                const fill = this.prekeyHighWater - preKeyCount;
                const keys = await this.generateKeys(fill);
                await this.server.registerKeys(keys);
            }
        },

        createAccount: async function(phone, verificationCode, identityKeyPair, deviceName) {
            const addr = phone; // XXX Some sort of conversion could happen here in the future.
            const signalingKey = libsignal.crypto.getRandomBytes(32 + 20);
            let password = btoa(getString(libsignal.crypto.getRandomBytes(16)));
            password = password.substring(0, password.length - 2);
            const registrationId = libsignal.KeyHelper.generateRegistrationId();
            const response = await this.server.confirmCode(addr, verificationCode,
                password, signalingKey, registrationId, deviceName);
            const deviceId = (response && response.deviceId) || 1;
            const addrId = `${addr}.${deviceId}`;
            const store = textsecure.store;
            await store.clearSessionStore();
            await store.removeOurIdentity();
            const wipestate = ['signalingKey', 'password', 'registrationId',
                'addrId', 'addr', 'deviceId', 'deviceName'];
            await Promise.all(wipestate.map(key => store.removeState(key)));
            // update our own identity key, which may have changed
            // if we're relinking after a reinstall on the master device
            await store.removeIdentityKey(addr);
            await store.saveIdentity(addr, identityKeyPair.pubKey);
            await store.saveOurIdentity(identityKeyPair);
            await store.putStateDict({signalingKey, password, registrationId,
                deviceName, addrId, addr, deviceId});
            this.server.username = addrId;
        },

        generateKeys: async function (count, progressCallback) {
            if (typeof progressCallback !== 'function') {
                progressCallback = undefined;
            }
            const startId = await textsecure.store.getState('maxPreKeyId', 1);
            const signedKeyId = await textsecure.store.getState('signedKeyId', 1);

            if (typeof startId != 'number') {
                throw new Error('Invalid maxPreKeyId');
            }
            if (typeof signedKeyId != 'number') {
                throw new Error('Invalid signedKeyId');
            }

            const ourIdent = await textsecure.store.getOurIdentity();
            const result = {
                preKeys: [],
                identityKey: ourIdent.pubKey
            };

            for (let keyId = startId; keyId < startId + count; ++keyId) {
                const prekey = await libsignal.KeyHelper.generatePreKey(keyId);
                await textsecure.store.storePreKey(prekey.keyId, prekey.keyPair);
                result.preKeys.push({
                    keyId: prekey.keyId,
                    publicKey: prekey.keyPair.pubKey
                });
                if (progressCallback) {
                    progressCallback(keyId - startId);
                }
            }

            const sprekey = await libsignal.KeyHelper.generateSignedPreKey(ourIdent, signedKeyId);
            await textsecure.store.storeSignedPreKey(sprekey.keyId, sprekey.keyPair);
            result.signedPreKey = {
                keyId: sprekey.keyId,
                publicKey: sprekey.keyPair.pubKey,
                signature: sprekey.signature
            };

            await textsecure.store.removeSignedPreKey(signedKeyId - 2);
            await textsecure.store.putStateDict({
                maxPreKeyId: startId + count,
                signedKeyId: signedKeyId + 1
            });
            return result;
        },

        registrationDone: function() {
            this.dispatchEvent(new Event('registration'));
        }
    });

    textsecure.AccountManager = AccountManager;
}());
