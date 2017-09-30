// vim: ts=4:sw=4:expandtab
/* global WebSocketResource, getString */


(function () {
    'use strict';

    const ns = self.textsecure = self.textsecure || {};

    const lastResortKeyId = 0xdeadbeef & ((2 ** 31) - 1); // Must fit inside signed 32bit int.

    ns.AccountManager = class AccountManager extends ns.EventTarget {

        constructor(url, username, password) {
            super();
            this.server = new ns.TextSecureServer(url, username, password);
            this.preKeyLowWater = 10;  // Add more keys when we get this low.
            this.preKeyHighWater = 100; // Max fill level for prekeys.
        }

        _generateDeviceInfo(identityKeyPair, addr, name) {
            const passwd = btoa(getString(libsignal.crypto.getRandomBytes(16)));
            return {
                addr,
                name,
                identityKeyPair,
                signalingKey: libsignal.crypto.getRandomBytes(32 + 20),
                registrationId: libsignal.KeyHelper.generateRegistrationId(),
                password: passwd.substring(0, passwd.length - 2)
            };
        }

        async registerAccount(addr, name) {
            const identity = await libsignal.KeyHelper.generateIdentityKeyPair();
            const devInfo = await this._generateDeviceInfo(identity, addr, name);
            await this.server.createAccount(devInfo);
            await this.saveDeviceState(devInfo);
            const keys = await this.generateKeys(this.preKeyHighWater);
            await this.server.registerKeys(keys);
            await this.registrationDone();
        }

        async registerDevice(setProvisioningUrl, confirmAddress, progressCallback) {
            const provisioningCipher = new ns.ProvisioningCipher();
            const pubKey = provisioningCipher.getPublicKey();
            const envelope = await new Promise((resolve, reject) => {
                const url = this.server.getProvisioningWebSocketURL();
                const wsr = new WebSocketResource(url, {
                    keepalive: {path: '/v1/keepalive/provisioning'},
                    handleRequest: request => {
                        if (request.path === "/v1/address" && request.verb === "PUT") {
                            const proto = ns.protobuf.ProvisioningUuid.decode(request.body);
                            const uriPubKey = encodeURIComponent(btoa(getString(pubKey)));
                            setProvisioningUrl(`tsdevice:/?uuid=${proto.uuid}&pub_key=${uriPubKey}`);
                            request.respond(200, 'OK');
                        } else if (request.path === "/v1/message" && request.verb === "PUT") {
                            const msgEnvelope = ns.protobuf.ProvisionEnvelope.decode(request.body, 'binary');
                            request.respond(200, 'OK');
                            wsr.close();
                            resolve(msgEnvelope);
                        } else {
                            reject(new Error('Unknown websocket message ' + request.path));
                        }
                    }
                });
                wsr.addEventListener('close',  e => reject(new Error('websocket closed')));
                wsr.connect();
            });
            const provisionMessage = await provisioningCipher.decrypt(envelope);
            const name = await confirmAddress(provisionMessage.addr);
            if (typeof name !== 'string' || name.length === 0) {
                throw new Error('Invalid device name');
            }
            const devInfo = await this._generateDeviceInfo(provisionMessage.identityKeyPair,
                                                           provisionMessage.addr, name);
            await this.server.addDevice(provisionMessage.provisioningCode, devInfo);
            await this.saveDeviceState(devInfo);
            const keys = await this.generateKeys(this.preKeyHighWater, progressCallback);
            await this.server.registerKeys(keys);
            await this.registrationDone();
        }

        async linkDevice(uuid, pubKey) {
            const code = await this.server.getLinkDeviceVerificationCode();
            const ourIdent = await ns.store.getOurIdentity();
            const pMessage = new ns.protobuf.ProvisionMessage();
            pMessage.identityKeyPrivate = ourIdent.privKey;
            pMessage.addr = F.currentUser.id;
            pMessage.userAgent = "boobies";
            pMessage.provisioningCode = code;
            const provisioningCipher = new ns.ProvisioningCipher();
            const pEnvelope = await provisioningCipher.encrypt(pubKey, pMessage);
            const pEnvBin = new Uint8Array(pEnvelope.toArrayBuffer());
            const resp = await this.server.fetch('/v1/provisioning/' + uuid, {
                method: 'PUT',
                json: {
                    body: btoa(String.fromCharCode.apply(null, pEnvBin))
                }
            });
            if (!resp.ok) {
                throw new Error(await resp.text());
            }
        }

        async refreshPreKeys() {
            const preKeyCount = await this.server.getMyKeys();
            const lastResortKey = await ns.store.loadPreKey(lastResortKeyId);
            if (preKeyCount <= this.preKeyLowWater || !lastResortKey) {
                // The server replaces existing keys so just go to the hilt.
                console.info("Refreshing pre-keys...");
                const keys = await this.generateKeys(this.preKeyHighWater);
                await this.server.registerKeys(keys);
            }
        }

        async saveDeviceState(info) {
            await ns.store.clearSessionStore();
            await ns.store.removeOurIdentity();
            const wipestate = [
                'addr',
                'deviceId',
                'name',
                'password',
                'registrationId',
                'signalingKey',
                'username',
            ];
            await Promise.all(wipestate.map(key => ns.store.removeState(key)));
            // update our own identity key, which may have changed
            // if we're relinking after a reinstall on the master device
            await ns.store.removeIdentityKey(info.addr);
            await ns.store.saveIdentity(info.addr, info.identityKeyPair.pubKey);
            await ns.store.saveOurIdentity(info.identityKeyPair);
            await ns.store.putStateDict(info);
        }

        async generateKeys(count, progressCallback) {
            if (typeof progressCallback !== 'function') {
                progressCallback = undefined;
            }
            const startId = await ns.store.getState('maxPreKeyId', 1);
            const signedKeyId = await ns.store.getState('signedKeyId', 1);

            if (typeof startId != 'number') {
                throw new Error('Invalid maxPreKeyId');
            }
            if (typeof signedKeyId != 'number') {
                throw new Error('Invalid signedKeyId');
            }

            let lastResortKey = await ns.store.loadPreKey(lastResortKeyId);
            if (!lastResortKey) {
                // Last resort key only used if our prekey pool is drained faster than
                // we refresh it.  This prevents message dropping at the expense of
                // forward secrecy impairment.
                const pk = await libsignal.KeyHelper.generatePreKey(lastResortKeyId);
                await ns.store.storePreKey(lastResortKeyId, pk.keyPair);
                lastResortKey = pk.keyPair;
            }

            const ourIdent = await ns.store.getOurIdentity();
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
                await ns.store.storePreKey(preKey.keyId, preKey.keyPair);
                result.preKeys.push({
                    keyId: preKey.keyId,
                    publicKey: preKey.keyPair.pubKey
                });
                if (progressCallback) {
                    progressCallback(keyId - startId);
                }
            }

            const sprekey = await libsignal.KeyHelper.generateSignedPreKey(ourIdent, signedKeyId);
            await ns.store.storeSignedPreKey(sprekey.keyId, sprekey.keyPair);
            result.signedPreKey = {
                keyId: sprekey.keyId,
                publicKey: sprekey.keyPair.pubKey,
                signature: sprekey.signature
            };

            await ns.store.removeSignedPreKey(signedKeyId - 2);
            await ns.store.putStateDict({
                maxPreKeyId: startId + count,
                signedKeyId: signedKeyId + 1
            });
            return result;
        }

        async registrationDone() {
            await this.dispatchEvent(new Event('registration'));
        }
    };
}());
