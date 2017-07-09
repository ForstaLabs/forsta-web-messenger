// vim: ts=4:sw=4:expandtab
/* global WebSocketResource, getString */


(function () {
    'use strict';
    self.textsecure = self.textsecure || {};

    function AccountManager(url, port, username, password) {
        this.server = new textsecure.TextSecureServer(url, port, username, password);
    }

    AccountManager.prototype = new textsecure.EventTarget();
    AccountManager.prototype.extend({
        constructor: AccountManager,

        requestVoiceVerification: function(number) {
            return this.server.requestVerificationVoice(number);
        },

        requestSMSVerification: function(number) {
            return this.server.requestVerificationSMS(number);
        },

        registerSingleDevice: function(number, verificationCode) {
            var registerKeys = this.server.registerKeys.bind(this.server);
            var createAccount = this.createAccount.bind(this);
            var generateKeys = this.generateKeys.bind(this, 100);
            var registrationDone = this.registrationDone.bind(this);
            return libsignal.KeyHelper.generateIdentityKeyPair().then(function(identityKeyPair) {
                return createAccount(number, verificationCode, identityKeyPair).
                    then(generateKeys).
                    then(registerKeys).
                    then(registrationDone);
            }.bind(this));
        },

        registerSecondDevice: function(setProvisioningUrl, confirmNumber, progressCallback) {
            var registerKeys = this.server.registerKeys.bind(this.server);
            var createAccount = this.createAccount.bind(this);
            var generateKeys = this.generateKeys.bind(this, 100, progressCallback);
            var registrationDone = this.registrationDone.bind(this);
            var getSocket = this.server.getProvisioningSocket.bind(this.server);
            var provisioningCipher = new libsignal.ProvisioningCipher();
            return provisioningCipher.getPublicKey().then(function(pubKey) {
                return new Promise(function(resolve, reject) {
                    var socket = getSocket();
                    socket.onclose = function(e) {
                        console.log('websocket closed', e.code);
                        reject(new Error('websocket closed'));
                    };
                    var wsr = new WebSocketResource(socket, {
                        keepalive: { path: '/v1/keepalive/provisioning' },
                        handleRequest: function(request) {
                            if (request.path === "/v1/address" && request.verb === "PUT") {
                                var proto = textsecure.protobuf.ProvisioningUuid.decode(request.body);
                                setProvisioningUrl([
                                    'tsdevice:/?uuid=', proto.uuid, '&pub_key=',
                                    encodeURIComponent(btoa(getString(pubKey)))
                                ].join(''));
                                request.respond(200, 'OK');
                            } else if (request.path === "/v1/message" && request.verb === "PUT") {
                                var envelope = textsecure.protobuf.ProvisionEnvelope.decode(request.body, 'binary');
                                request.respond(200, 'OK');
                                wsr.close();
                                resolve(provisioningCipher.decrypt(envelope).then(function(provisionMessage) {
                                    return confirmNumber(provisionMessage.number).then(function(deviceName) {
                                        if (typeof deviceName !== 'string' || deviceName.length === 0) {
                                            throw new Error('Invalid device name');
                                        }
                                        return createAccount(
                                            provisionMessage.number,
                                            provisionMessage.provisioningCode,
                                            provisionMessage.identityKeyPair,
                                            deviceName
                                        );
                                    });
                                }));
                            } else {
                                console.log('Unknown websocket message', request.path);
                            }
                        }
                    });
                });
            }).then(generateKeys).
               then(registerKeys).
               then(registrationDone);
        },

        refreshPreKeys: function() {
            var generateKeys = this.generateKeys.bind(this, 100);
            var registerKeys = this.server.registerKeys.bind(this.server);
            return this.server.getMyKeys().then(function(preKeyCount) {
                console.log('prekey count ' + preKeyCount);
                if (preKeyCount < 10) {
                    return generateKeys().then(registerKeys);
                }
            }.bind(this));
        },

        createAccount: async function(number, verificationCode, identityKeyPair, deviceName) {
            const signalingKey = libsignal.crypto.getRandomBytes(32 + 20);
            let password = btoa(getString(libsignal.crypto.getRandomBytes(16)));
            password = password.substring(0, password.length - 2);
            const registrationId = libsignal.KeyHelper.generateRegistrationId();
            const response = await this.server.confirmCode(number, verificationCode,
                password, signalingKey, registrationId, deviceName);
            const deviceId = response.deviceId || 1;
            const numberId = `${number}.${deviceId}`;
            const store = textsecure.store;
            await store.clearSessionStore();
            await store.removeOurIdentity();
            const wipestate = ['signalingKey', 'password', 'registrationId',
                'numberId', 'number', 'deviceId', 'deviceName'];
            await Promise.all(wipestate.map(key => store.removeState(key)));
            // update our own identity key, which may have changed
            // if we're relinking after a reinstall on the master device
            await store.removeIdentityKey(number);
            await store.saveIdentity(number, identityKeyPair.pubKey);
            await store.saveOurIdentity(identityKeyPair);
            await store.putStateDict({signalingKey, password, registrationId,
                deviceName, numberId, number, deviceId});
            this.server.username = numberId;
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
                    keyId     : prekey.keyId,
                    publicKey : prekey.keyPair.pubKey
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
