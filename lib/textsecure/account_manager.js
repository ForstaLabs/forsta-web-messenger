// vim: ts=4:sw=4:expandtab
/* global WebSocketResource, getString */


(function () {
    'use strict';

    self.textsecure = self.textsecure || {};

    const lastResortKeyId = 0xdeadbeaf;

    function AccountManager(url, username, password) {
        this.server = new textsecure.TextSecureServer(url, username, password);
        this.preKeyLowWater = 10;  // Add more keys when we get this low.
        this.preKeyHighWater = 100; // Max fill level for prekeys.
    }

    AccountManager.prototype = new textsecure.EventTarget();
    AccountManager.prototype.extend({
        constructor: AccountManager,

        requestVoiceVerification: function(phone) {
            // Deprecated
            return this.server.requestVerificationVoice(phone);
        },

        requestSMSVerification: function(phone) {
            // Deprecated
            return this.server.requestVerificationSMS(phone);
        },

        _generateDeviceInfo: function(identityKeyPair, addr, deviceName) {
            const passwd = btoa(getString(libsignal.crypto.getRandomBytes(16)));
            return {
                addr,
                deviceName,
                identityKeyPair,
                signalingKey: libsignal.crypto.getRandomBytes(32 + 20),
                registrationId: libsignal.KeyHelper.generateRegistrationId(),
                password: passwd.substring(0, passwd.length - 2)
            };
        },

        registerAccount: async function(addr, deviceName) {
            const identity = await libsignal.KeyHelper.generateIdentityKeyPair();
            const devInfo = await this._generateDeviceInfo(identity, addr, deviceName);
            await this.server.createAccount(devInfo);
            await this.saveDeviceState(devInfo);
            const keys = await this.generateKeys(this.preKeyHighWater);
            await this.server.registerKeys(keys);
            this.registrationDone();
        },

        registerDevice: async function(setProvisioningUrl, confirmPhone, progressCallback) {
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
            const devInfo = await this._generateDeviceInfo(provisionMessage.identityKeyPair,
                                                           provisionMessage.addr, deviceName);
            await this.server.addDevice(provisionMessage.provisioningCode, devInfo);
            await this.saveDeviceState(devInfo);
            const keys = await this.generateKeys(this.preKeyHighWater, progressCallback);
            await this.server.registerKeys(keys);
            this.registrationDone();
        },

        refreshPreKeys: async function() {
            const preKeyCount = await this.server.getMyKeys();
            if (preKeyCount <= this.preKeyLowWater) {
                // The server replaces existing keys so just go to the hilt.
                const keys = await this.generateKeys(this.preKeyHighWater);
                await this.server.registerKeys(keys);
            }
        },

        saveDeviceState: async function(info) {
            const store = textsecure.store;
            await store.clearSessionStore();
            await store.removeOurIdentity();
            const wipestate = [
                'addr',
                'deviceId',
                'deviceName',
                'password',
                'registrationId',
                'signalingKey',
                'username',
            ];
            await Promise.all(wipestate.map(key => store.removeState(key)));
            // update our own identity key, which may have changed
            // if we're relinking after a reinstall on the master device
            await store.removeIdentityKey(info.addr);
            await store.saveIdentity(info.addr, info.identityKeyPair.pubKey);
            await store.saveOurIdentity(info.identityKeyPair);
            await store.putStateDict(info);
            this.server.username = info.username;
            this.server.password = info.password;
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

            let lastResortKey = await textsecure.store.loadPreKey(lastResortKeyId);
            if (!lastResortKey) {
                // Last resort key only used if our prekey pool is drained faster than
                // we refresh it.  This prevents message dropping at the expense of
                // forward secrecy impairment.
                const pk = await libsignal.KeyHelper.generatePreKey(lastResortKeyId);
                await textsecure.store.storePreKey(lastResortKeyId, pk.keyPair);
                lastResortKey = pk.keyPair;
            }

            const ourIdent = await textsecure.store.getOurIdentity();
            const result = {
                preKeys: [],
                identityKey: ourIdent.pubKey,
                lastResortKey: {
                    keyId: lastResortKeyId,
                    publicKey: lastResortKey.pubKey
                }
            };

            for (let keyId = startId; keyId < startId + count; ++keyId) {
                const preKey = await libsignal.KeyHelper.generatePreKey(keyId);
                await textsecure.store.storePreKey(preKey.keyId, preKey.keyPair);
                result.preKeys.push({
                    keyId: preKey.keyId,
                    publicKey: preKey.keyPair.pubKey
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
