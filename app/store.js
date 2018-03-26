// vim: ts=4:sw=4:expandtab
/* global dcodeIO stringObject relay Backbone */

(function() {
    'use strict';

    self.F = self.F || {};

    const StaticByteBufferProto = new dcodeIO.ByteBuffer().__proto__;
    const StaticArrayBufferProto = new ArrayBuffer().__proto__;
    const StaticUint8ArrayProto = new Uint8Array().__proto__;

    function isStringable(thing) {
        return thing === Object(thing &&
                                (thing.__proto__ == StaticArrayBufferProto ||
                                 thing.__proto__ == StaticUint8ArrayProto ||
                                 thing.__proto__ == StaticByteBufferProto));
    }

    function convertToArrayBuffer(thing) {
        if (thing === undefined) {
            return;
        }
        if (thing === Object(thing)) {
            if (thing.__proto__ == StaticArrayBufferProto) {
                return thing;
            }
            //TODO: Several more cases here...
        }

        if (thing instanceof Array) {
            // Assuming Uint16Array from curve25519
            const res = new ArrayBuffer(thing.length * 2);
            const uint = new Uint16Array(res);
            for (let i = 0; i < thing.length; i++) {
                uint[i] = thing[i];
            }
            return res;
        }

        let str;
        if (isStringable(thing)) {
            str = stringObject(thing);
        } else if (typeof thing == "string") {
            str = thing;
        } else {
            throw new Error("Tried to convert a non-stringable thing of type " + typeof thing + " to an array buffer");
        }
        const res = new ArrayBuffer(str.length);
        const uint = new Uint8Array(res);
        for (let i = 0; i < str.length; i++) {
            uint[i] = str.charCodeAt(i);
        }
        return res;
    }

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

        async loadPreKey(keyId) {
            /* Returns a prekeypair object or undefined */
            const prekey = new PreKey({id: keyId});
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

        async storePreKey(keyId, keyPair) {
            const prekey = new PreKey({
                id: keyId,
                publicKey: keyPair.pubKey,
                privateKey: keyPair.privKey
            });
            await prekey.save();
        }

        async removePreKey(keyId) {
            const prekey = new PreKey({id: keyId});
            try {
                await prekey.destroy();
            } finally {
                const am = await F.foundation.getAccountManager();
                am.refreshPreKeys(); // Run promise in BG; It's low prio.
            }
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
                session = new Session({id: encodedAddr});
                try {
                    await session.fetch();
                } catch(e) {
                    if (e instanceof ReferenceError) {
                        return;
                    } else {
                        throw e;
                    }
                }
                sessionCollection.add(session);
            }
            return session.get('record');
        }

        async storeSession(encodedAddr, record) {
            if (!encodedAddr) {
                throw new Error("Invalid Encoded Signal Address");
            }
            const tuple = relay.util.unencodeAddr(encodedAddr);
            const addr = tuple[0];
            const deviceId = parseInt(tuple[1]);
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
            const addr = relay.util.unencodeAddr(identifier)[0];
            const identityKey = await this.loadIdentity(addr);
            const oldpublicKey = identityKey.get('publicKey');
            return !oldpublicKey || equalArrayBuffers(oldpublicKey, publicKey);
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
                publicKey = convertToArrayBuffer(publicKey);
            }
            const addr = relay.util.unencodeAddr(identifier)[0];
            const identityKey = await this.loadIdentity(addr);
            const oldpublicKey = identityKey.get('publicKey');
            if (!oldpublicKey) {
                identityKey.set({publicKey});
                identityKeyCache.set(addr, identityKey);
                await identityKey.save();
            } else if (!equalArrayBuffers(oldpublicKey, publicKey)) {
                throw new Error("Attempted to overwrite a different identity key");
            }
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
                F.util.reportError("Contact not found during isBlocked check!", addr);
                return false;
            }
            return !!contact.get('blocked');
        }
    };
})();
