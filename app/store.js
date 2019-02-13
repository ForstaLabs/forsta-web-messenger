// vim: ts=4:sw=4:expandtab
/* global relay Backbone */

(function() {
    'use strict';

    self.F = self.F || {};

    function equalArrayBuffers(a, b) {
        if (!(a instanceof ArrayBuffer && a instanceof ArrayBuffer)) {
            return false;
        }
        const aLen = a.byteLength;
        if (aLen !== b.byteLength) {
            return false;
        }
        const aArr = new Uint8Array(a);
        const bArr = new Uint8Array(b);
        for (let i = 0; i < aLen; i++) {
            if (aArr[i] !== bArr[i]) {
                return false;
            }
        }
        return true;
    }

    const Model = Backbone.Model.extend({database: F.Database});
    const PreKey = Model.extend({storeName: 'preKeys'});
    const SignedPreKey = Model.extend({storeName: 'signedPreKeys'});
    const Session = Model.extend({storeName: 'sessions'});

    const PreKeyCollection = Backbone.Collection.extend({
        storeName: 'preKeys',
        database: F.Database,
        model: PreKey
    });
    const SignedPreKeyCollection = Backbone.Collection.extend({
        storeName: 'signedPreKeys',
        database: F.Database,
        model: SignedPreKey
    });

    const sessionCollection = new (Backbone.Collection.extend({
        storeName: 'sessions',
        database: F.Database,
        model: Session,

        fetchSessionsForAddr: async function(addr) {
            await this.fetch({
                remove: false,
                range: [addr + '.1', addr + '.' + ':']
            });
        },

        getSessionsForAddr: function(addr) {
            return this.filter(x => x.get('addr') === addr);
        }
    }))();
    const IdentityKey = Model.extend({storeName: 'identityKeys'});
    const identityKeyCache = new Map();


    F.RelayStore = class RelayStore {

        constructor() {
            _.extend(this, Backbone.Events);
        }

        async getState(key, defaultValue) {
            return await F.state.get(key, defaultValue);
        }

        async getStateDict(keys) {
            return await F.state.getDict(keys);
        }

        async putState(key, value) {
            return await F.state.put(key, value);
        }

        async putStateDict(dict) {
            return await F.state.putDict(dict);
        }

        async removeState(key) {
            return await F.state.remove(key);
        }

        async getOurIdentity() {
            return await F.state.get('ourIdentity');
        }

        async getIdentityKeyPair() {
            // Legacy but used by libsignal
            return await this.getOurIdentity();
        }

        async saveOurIdentity(keys) {
            return await F.state.put('ourIdentity', keys);
        }

        async removeOurIdentity(keys) {
            return await F.state.remove('ourIdentity');
        }

        async getOurRegistrationId() {
            return await F.state.get('registrationId');
        }

        async getLocalRegistrationId() {
            // Legacy but used by libsignal
            return await this.getOurRegistrationId();
        }

        async getPreKeys() {
            const collection = new PreKeyCollection();
            await collection.fetch();
            return collection.models;
        }

        async loadPreKey(keyId) {
            /* Returns a prekeypair object or undefined */
            const prekey = await this._loadPreKey(keyId);
            return prekey && {
                removed: prekey.get('removed'),
                pubKey: prekey.get('publicKey'),
                privKey: prekey.get('privateKey')
            };
        }

        async _loadPreKey(keyId) {
            /* Returns a prekey model or undefined */
            const prekey = new PreKey({id: keyId});
            try {
                await prekey.fetch();
            } catch(e) {
                return;
            }
            if (prekey.get('removed')) {
                console.warn("A removed prekey is being re-used!:", keyId);
            }
            return prekey;
        }

        async storePreKey(keyId, keyPair) {
            const prekey = new PreKey({
                id: keyId,
                publicKey: keyPair.pubKey,
                privateKey: keyPair.privKey
            });
            await prekey.save();
        }

        async removePreKey(keyId) {
            try {
                const prekey = await this._loadPreKey(keyId);
                if (!prekey) {
                    return;
                }
                if (prekey.get('removed')) {
                    console.warn("PreKey was already removed:", keyId);
                    return;
                }
                await prekey.save({removed: Date.now()});  // Let TBD GC remove it later.
            } finally {
                const am = await F.foundation.getAccountManager();
                am.refreshPreKeys(); // Run promise in BG; It's low prio.
            }
        }

        async getSignedPreKeys() {
            const collection = new SignedPreKeyCollection();
            await collection.fetch();
            return collection.models;
        }

        async loadSignedPreKey(keyId) {
            /* Returns a signed keypair object or undefined */
            const prekey = new SignedPreKey({id: keyId});
            try {
                await prekey.fetch();
            } catch(e) {
                return;
            }
            return {
                pubKey: prekey.attributes.publicKey,
                privKey: prekey.attributes.privateKey
            };
        }

        async storeSignedPreKey(keyId, keyPair) {
            const prekey = new SignedPreKey({
                id: keyId,
                publicKey: keyPair.pubKey,
                privateKey: keyPair.privKey
            });
            await prekey.save();
        }

        async removeSignedPreKey(keyId) {
            const prekey = new SignedPreKey({id: keyId});
            try {
                await prekey.destroy();
            } catch(e) {
                if (e instanceof ReferenceError) {
                    return false;
                } else {
                    throw e;
                }
            }
            return true;
        }

        async loadSession(encodedAddr) {
            if (!encodedAddr) {
                throw new Error("Invalid Encoded Signal Address");
            }
            let session = sessionCollection.get(encodedAddr);
            if (!session) {
                // During a cache miss, we need to load ALL sessions for this address.
                // Otherwise we corrupt the results for getDeviceIds by only loading one
                // entry for this address and cause spurious 409 responses to message sends.
                await sessionCollection.fetchSessionsForAddr(encodedAddr.split('.')[0]);
                session = sessionCollection.get(encodedAddr);
            }
            return session && session.get('record');
        }

        async storeSession(encodedAddr, record) {
            if (!encodedAddr) {
                throw new Error("Invalid Encoded Signal Address");
            }
            const tuple = relay.util.unencodeAddr(encodedAddr);
            const addr = tuple[0];
            const deviceId = tuple[1];
            let session = sessionCollection.get(encodedAddr);
            if (!session) {
                session = new Session({id: encodedAddr});
                await session.fetch({not_found_error: false});
                sessionCollection.add(session);
            }
            await session.save({record, deviceId, addr});
        }

        async getDeviceIds(addr) {
            if (!addr) {
                throw new Error("Invalid Signal Address");
            }
            let deviceSessions = sessionCollection.getSessionsForAddr(addr);
            if (!deviceSessions.length) {
                await sessionCollection.fetchSessionsForAddr(addr);
                deviceSessions = sessionCollection.getSessionsForAddr(addr);
            }
            return deviceSessions.map(x => x.get('deviceId'));
        }

        async removeSession(encodedAddr) {
            const session = new Session({id: encodedAddr});
            await session.destroy();
            sessionCollection.remove([encodedAddr]);
        }

        async removeAllSessions(addr) {
            if (!addr) {
                throw new Error("Invalid Signal Address");
            }
            await sessionCollection.fetchSessionsForAddr(addr);
            await Promise.all(sessionCollection.getSessionsForAddr(addr).map(x => x.destroy()));
        }

        async clearSessionStore() {
            await sessionCollection.sync('delete', sessionCollection, {});
        }

        async isTrustedIdentity(identifier, publicKey) {
            if (!identifier) {
                throw new TypeError("`identifier` required");
            }
            if (!(publicKey instanceof ArrayBuffer)) {
                throw new TypeError("publicKey must be ArrayBuffer");
            }
            const identityKey = await this.loadIdentity(identifier);
            const trustedPublicKey = identityKey.get('publicKey');
            if (!trustedPublicKey) {
                console.warn("Implicit trust of new identity:", identifier);
                await this.saveIdentity(identifier, publicKey);
            }
            return !trustedPublicKey || equalArrayBuffers(trustedPublicKey, publicKey);
        }

        async loadIdentity(identifier) {
            const addr = relay.util.unencodeAddr(identifier)[0];
            if (identityKeyCache.has(addr)) {
                return identityKeyCache.get(addr);
            }
            const identityKey = new IdentityKey({id: addr});
            try {
                await identityKey.fetch();
                identityKeyCache.set(addr, identityKey);
            } catch(e) {
                if (!(e instanceof ReferenceError)) {
                    throw e;
                }
            }
            return identityKey;
        }

        async getIdentityKey(identifier) {
            const identityKey = await this.loadIdentity(identifier);
            const pubKey = identityKey.get('publicKey');
            return pubKey && new Uint8Array(pubKey);
        }

        async saveIdentity(identifier, publicKey) {
            if (!identifier) {
                throw new TypeError("`identifier` required");
            }
            if (!(publicKey instanceof ArrayBuffer)) {
                throw new TypeError("publicKey must be ArrayBuffer");
            }
            const addr = relay.util.unencodeAddr(identifier)[0];
            const identityKey = await this.loadIdentity(addr);
            const oldPublicKey = identityKey.get('publicKey');
            if (oldPublicKey && !equalArrayBuffers(oldPublicKey, publicKey)) {
                console.warn("Changing trusted identity key for:", addr);
                await this.removeAllSessions(addr);
            }
            identityKey.set({publicKey});
            identityKeyCache.set(addr, identityKey);
            await identityKey.save();
        }

        async removeIdentity(identifier) {
            const addr = relay.util.unencodeAddr(identifier)[0];
            const identityKey = new IdentityKey({id: addr});
            identityKeyCache.delete(addr);
            await identityKey.destroy();
            await this.removeAllSessions(addr);
        }

        async isBlocked(addr) {
            const contact = await F.atlas.getContact(addr);
            if (!contact) {
                F.util.reportWarning("Contact not found during isBlocked check!", addr);
                return false;
            }
            return !!contact.get('blocked');
        }
    };
})();
