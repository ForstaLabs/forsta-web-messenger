// vim: ts=4:sw=4:expandtab
/* global dcodeIO, stringObject */

(function() {
    'use strict';

    self.F = self.F || {};

    var StaticByteBufferProto = new dcodeIO.ByteBuffer().__proto__;
    var StaticArrayBufferProto = new ArrayBuffer().__proto__;
    var StaticUint8ArrayProto = new Uint8Array().__proto__;

    function isStringable(thing) {
        return (thing === Object(thing) &&
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

    function equalArrayBuffers(ab1, ab2) {
        if (!(ab1 instanceof ArrayBuffer && ab2 instanceof ArrayBuffer)) {
            return false;
        }
        if (ab1.byteLength !== ab2.byteLength) {
            return false;
        }
        var result = true;
        var ta1 = new Uint8Array(ab1);
        var ta2 = new Uint8Array(ab2);
        for (var i = 0; i < ab1.byteLength; ++i) {
            if (ta1[i] !== ta2[i]) { result = false; }
        }
        return result;
    }

    const Model = Backbone.Model.extend({database: F.Database});
    const PreKey = Model.extend({storeName: 'preKeys'});
    const SignedPreKey = Model.extend({storeName: 'signedPreKeys'});
    const Session = Model.extend({storeName: 'sessions'});
    const SessionCollection = Backbone.Collection.extend({
        storeName: 'sessions',
        database: F.Database,
        model: Session,
        fetchSessionsForAddr: function(addr) {
            return this.fetch({range: [addr + '.1', addr + '.' + ':']});
        }
    });
    const IdentityKey = Model.extend({storeName: 'identityKeys'});


    F.TextSecureStore = class TextSecureStore {

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
            return await this.getOurIdentity();
        }

        async saveOurIdentity(keys) {
            return await F.state.put('ourIdentity', keys);
        }

        async removeOurIdentity(keys) {
            return await F.state.remove('ourIdentity');
        }

        async getLocalRegistrationId() {
            return await F.state.get('registrationId');
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
            var prekey = new PreKey({
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
            var prekey = new SignedPreKey({
                id         : keyId,
                publicKey  : keyPair.pubKey,
                privateKey : keyPair.privKey
            });
            await prekey.save();
        }

        async removeSignedPreKey(keyId) {
            const prekey = new SignedPreKey({id: keyId});
            try {
                await prekey.destroy();
            } catch(e) {
                if (e.message !== 'Not Found') {
                    throw e;
                }
                return false;
            }
            return true;
        }

        async loadSession(encodedAddr) {
            if (!encodedAddr) {
                throw new Error("Invalid Encoded Signal Address");
            }
            const session = new Session({id: encodedAddr});
            await session.fetch({not_found_error: false});
            return session.get('record');
        }

        async storeSession(encodedAddr, record) {
            if (!encodedAddr) {
                throw new Error("Invalid Encoded Signal Address");
            }
            const tuple = textsecure.utils.unencodeAddr(encodedAddr);
            const addr = tuple[0];
            const deviceId = parseInt(tuple[1]);
            const session = new Session({id: encodedAddr});
            await session.fetch({not_found_error: false});
            await session.save({record, deviceId, addr});
        }

        async getDeviceIds(addr) {
            if (!addr) {
                throw new Error("Invalid Signal Address");
            }
            /* XXX: This is way too heavy, cache! */
            const sessions = new SessionCollection();
            await sessions.fetchSessionsForAddr(addr);
            return sessions.pluck('deviceId');
        }

        async removeSession(encodedAddr) {
            const session = new Session({id: encodedAddr});
            await session.fetch(); // XXX I don't think we need to fetch first.
            await session.destroy();
        }

        async removeAllSessions(addr) {
            if (!addr) {
                throw new Error("Invalid Signal Address");
            }
            const sessions = new SessionCollection();
            await sessions.fetchSessionsForAddr(addr);
            const removals = [];
            while (sessions.length > 0) {
                removals.push(sessions.pop().destroy());
            }
            await Promise.all(removals);
        }

        async clearSessionStore() {
            const sessions = new SessionCollection();
            await sessions.sync('delete', sessions, {});
        }

        async isTrustedIdentity(identifier, publicKey) {
            if (identifier === null || identifier === undefined) {
                throw new Error("Tried to get identity key for undefined/null key");
            }
            const addr = textsecure.utils.unencodeAddr(identifier)[0];
            const identityKey = new IdentityKey({id: addr});
            await identityKey.fetch({not_found_error: false});
            const oldpublicKey = identityKey.get('publicKey');
            if (!oldpublicKey || equalArrayBuffers(oldpublicKey, publicKey)) {
                return true;
            } else if (!(await F.state.get('safetyAddrsApproval', false))) {
                console.warn('Auto accepting key change for', identifier);
                await this.removeIdentityKey(identifier);
                await this.saveIdentity(identifier, publicKey);
                this.trigger('keychange:' + identifier);
                return true;
            } else {
                return false;
            }
        }

        async getIdentityKey(id) {
            const identityKey = new IdentityKey({id});
            await identityKey.fetch({not_found_error: false});
            return identityKey;
        }

        async saveIdentity(identifier, publicKey) {
            if (identifier === null || identifier === undefined) {
                throw new Error("Tried to put identity key for undefined/null key");
            }
            if (!(publicKey instanceof ArrayBuffer)) {
                publicKey = convertToArrayBuffer(publicKey);
            }
            const addr = textsecure.utils.unencodeAddr(identifier)[0];
            const identityKey = await this.getIdentityKey(addr);
            const oldpublicKey = identityKey.get('publicKey');
            if (!oldpublicKey) {
                // Lookup failed, or the current key was removed, so save this one.
                await identityKey.save({publicKey});
            } else {
                // Key exists, if it matches do nothing, else throw
                if (!equalArrayBuffers(oldpublicKey, publicKey)) {
                    throw new Error("Attempted to overwrite a different identity key");
                }
            }
        }

        async removeIdentityKey(addr) {
            const identityKey = new IdentityKey({id: addr});
            try {
                await identityKey.destroy();
            } catch(e) {
                if (e.message !== 'Not Found') { // XXX might be "Not Deleted"
                    throw e;
                }
                console.warn(`Tried to remove identity for unknown signal address: ${addr}`);
                return false;
            }
            await this.removeAllSessions(addr);
            return true;
        }
    };
})();
