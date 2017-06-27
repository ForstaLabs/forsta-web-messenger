/*
 * vim: ts=4:sw=4:expandtab
 */
;(function() {
    'use strict';

    self.F = self.F || {};
    F.store = {};

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
            return undefined;
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
            for (var i = 0; i < thing.length; i++) {
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
        for (var i = 0; i < str.length; i++) {
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

    /* copy/pasta from textsecure helpers */
    function getString(thing) {
        if (thing === Object(thing)) {
            if (thing.__proto__ == StaticUint8ArrayProto)
                return String.fromCharCode.apply(null, thing);
            if (thing.__proto__ == StaticArrayBufferProto)
                return getString(new Uint8Array(thing));
            if (thing.__proto__ == StaticByteBufferProto)
                return thing.toString("binary");
        }
        return thing;
    }


    const Model = Backbone.Model.extend({database: F.Database});
    const PreKey = Model.extend({storeName: 'preKeys'});
    const SignedPreKey = Model.extend({storeName: 'signedPreKeys'});
    const Session = Model.extend({storeName: 'sessions'});
    const SessionCollection = Backbone.Collection.extend({
        storeName: 'sessions',
        database: F.Database,
        model: Session,
        fetchSessionsForNumber: function(number) {
            return this.fetch({range: [number + '.1', number + '.' + ':']});
        }
    });
    const IdentityKey = Model.extend({storeName: 'identityKeys'});
    const Group = Model.extend({storeName: 'groups'});


    class SignalProtocolStore {

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
                return undefined;
            }
            return {
                pubKey: prekey.attributes.publicKey,
                privKey: prekey.attributes.privateKey
            };
        }

        async storePreKey(keyId, keyPair) {
            var prekey = new PreKey({
                id         : keyId,
                publicKey  : keyPair.pubKey,
                privateKey : keyPair.privKey
            });
            await prekey.save();
        }

        async removePreKey(keyId) {
            const prekey = new PreKey({id: keyId});
            const am = await F.foundation.getAccountManager();
            am.refreshPreKeys(); // Run promise in BG it's low prio.
            await prekey.destroy(); // XXX this used to eat errors
        }

        async loadSignedPreKey(keyId) {
            /* Returns a signed keypair object or undefined */
            const prekey = new SignedPreKey({id: keyId});
            try {
                await prekey.fetch();
            } catch(e) {
                return undefined;
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
                // XXX try to convert to not_found_error: false 
                if (e.message !== 'Not Found') {
                    throw e;
                }
                return false;
            }
            return true;
        }

        async loadSession(encodedNumber) {
            if (encodedNumber === null || encodedNumber === undefined) {
                throw new Error("Tried to get session for undefined/null number");
            }
            const session = new Session({id: encodedNumber});
            await session.fetch({not_found_error: false});
            return session.get('record');
        }

        async storeSession(encodedNumber, record) {
            if (encodedNumber === null || encodedNumber === undefined) {
                throw new Error("Tried to put session for undefined/null number");
            }
            const tuple = textsecure.utils.unencodeNumber(encodedNumber)
            const number = tuple[0];
            const deviceId = parseInt(tuple[1]);
            const session = new Session({id: encodedNumber});
            await session.fetch({not_found_error: false});
            await session.save({record, deviceId, number}); // XXX this used to catch exceptions without rethrowing
        }

        async getDeviceIds(number) {
            if (number === null || number === undefined) {
                throw new Error("Tried to get device ids for undefined/null number");
            }
            const sessions = new SessionCollection();
            await sessions.fetchSessionsForNumber(number); // XXX used to never allow fail!
            return sessions.pluck('deviceId');
        }

        async removeSession(encodedNumber) {
            const session = new Session({id: encodedNumber});
            await session.fetch(); // XXX This used to eat errors
            await session.destroy(); // XXX This used to eat errors
        }

        async removeAllSessions(number) {
            if (number === null || number === undefined) {
                throw new Error("Tried to remove sessions for undefined/null number");
            }
            const sessions = new SessionCollection();
            await sessions.fetchSessionsForNumber(number); // XXX used to never fail!
            const removals = [];
            while (sessions.length > 0) {
                removals.push(sessions.pop().destroy());
            }
            await Promise.all(removals); // XXX Used to eat failures.
        }

        async clearSessionStore() {
            const sessions = new SessionCollection();
            await sessions.sync('delete', sessions, {}); // XXX used to never fail!
        }

        async isTrustedIdentity(identifier, publicKey) {
            if (identifier === null || identifier === undefined) {
                throw new Error("Tried to get identity key for undefined/null key");
            }
            const number = textsecure.utils.unencodeNumber(identifier)[0];
            const identityKey = new IdentityKey({id: number});
            await identityKey.fetch({not_found_error: false});
            const oldpublicKey = identityKey.get('publicKey');
            if (!oldpublicKey || equalArrayBuffers(oldpublicKey, publicKey)) {
                return true;
            } else if (!await F.state.get('safetyNumbersApproval', true)) {
                console.warn('Key changed for', identifier);
                await this.removeIdentityKey(identifier);
                await this.saveIdentity(identifier, publicKey);
                this.trigger('keychange:' + identifier);
                return true;
            } else {
                return false;
            }
        }

        async loadIdentityKey(identifier) {
            if (identifier === null || identifier === undefined) {
                throw new Error("Tried to get identity key for undefined/null key");
            }
            const number = textsecure.utils.unencodeNumber(identifier)[0];
            const identityKey = new IdentityKey({id: number});
            await identityKey.fetch(); // XXX used to never fail!
            return identityKey.get('publicKey');
        }

        async saveIdentity(identifier, publicKey) {
            if (identifier === null || identifier === undefined) {
                throw new Error("Tried to put identity key for undefined/null key");
            }
            if (!(publicKey instanceof ArrayBuffer)) {
                publicKey = convertToArrayBuffer(publicKey);
            }
            const number = textsecure.utils.unencodeNumber(identifier)[0];
            const identityKey = new IdentityKey({id: number});
            await identityKey.fetch({not_found_error: false});
            const oldpublicKey = identityKey.get('publicKey');
            if (!oldpublicKey) {
                // Lookup failed, or the current key was removed, so save this one.
                await identityKey.save({publicKey: publicKey});
            } else {
                // Key exists, if it matches do nothing, else throw
                if (!equalArrayBuffers(oldpublicKey, publicKey)) {
                    reject(new Error("Attempted to overwrite a different identity key"));
                }
            }
        }

        async removeIdentityKey(number) {
            const identityKey = new IdentityKey({id: number});
            try {
                await identityKey.destroy();
            } catch(e) {
                if (e.message !== 'Not Found') { // XXX might be "Not Deleted"
                    throw e;
                }
                console.warn(`Tried to remove identity for unknown number: ${number}`);
                return false;
            }
            await this.removeAllSessions(number);
            return true;
        }

        async getGroup(id) {
            if (id === null || id === undefined) {
                throw new Error("Tried to get group for undefined/null id");
            }
            const group = new Group({id});
            try {
                await group.fetch();
            } catch(e) {
                if (e.message !== 'Not Found') {
                    throw e;
                }
                return;
            }
            return group;
        }

        async putGroup(id, attrs) {
            if (id === null || id === undefined) {
                throw new Error("Tried to put group key for undefined/null id");
            }
            if (data === null || data === undefined) {
                throw new Error("Tried to put undefined/null group object");
            }
            attrs.id = id;
            const group = new Group({attrs});
            await group.save();
            return group;
        }

        async removeGroup(id) {
            if (id === null || id === undefined) {
                throw new Error("Tried to remove group key for undefined/null id");
            }
            const group = new Group({id});
            await group.destroy();
        }
    }


    F.TextSecureStore = class TextSecureStore extends SignalProtocolStore {

        async _generateNewGroupId() {
            var groupId = getString(libsignal.crypto.getRandomBytes(16));
            const group = await this.getGroup(groupId);
            if (group === undefined) {
                return groupId;
            } else {
                console.warn('group id collision'); // probably a bad sign.
                return await this._generateNewGroupId();
            }
        }

        async createGroup(numbers, groupId) {
            if (groupId !== undefined) {
                const group = await this.getGroup(groupId);
                if (group !== undefined) {
                    throw new Error("Tried to recreate group");
                }
            } else {
                groupId = await this._generateNewGroupId();
            }
            /* XXX Use a Set() and simplify this. */
            const me = await this.getState('number');
            let haveMe = false;
            const finalNumbers = [];
            for (let i in numbers) {
                const number = numbers[i];
                if (number === me)
                    haveMe = true;
                if (finalNumbers.indexOf(number) < 0)
                    finalNumbers.push(number);
            }
            if (!haveMe)
                finalNumbers.push(me);
            const groupObject = {
                numbers: finalNumbers,
                numberRegistrationIds: {}
            };
            for (var i in finalNumbers)
                groupObject.numberRegistrationIds[finalNumbers[i]] = {};
            return await this.putGroup(groupId, groupObject);
        }

        async getGroupNumbers(groupId) {
            const group = await this.getGroup(groupId);
            return group && group.get('numbers');
        }

        async removeGroupNumber(groupId, number) {
            const group = await this.getGroup(groupId);
            if (group === undefined)
                return undefined;
            var me = await this.getState('number');
            if (number == me)
                throw new Error("Cannot remove ourselves from a group, leave the group instead");
            const i = group.get('numbers').indexOf(number);
            if (i > -1) {
                group.numbers.splice(i, 1);
                delete group.numberRegistrationIds[number];
                return textsecure.storage.protocol.putGroup(groupId, group).then(function() {
                    return group.numbers;
                });
            }
            return group.get('numbers');
        }

        async addGroupNumbers(groupId, numbers) {
            const group = this.getGroup(groupId);
            if (group === undefined)
                return undefined;
            const gNumbers = group.get('numbers');
            for (let i in numbers) {
                const number = numbers[i];
                if (gNumbers.indexOf(number) < 0) {
                    gNumbers.push(number);
                    group.get('numberRegistrationIds')[number] = {};
                }
            }
            await this.putGroup(groupId, group);
            return gNumbers;
        }

        async deleteGroup(groupId) {
            return await this.removeGroup(groupId);
        }

        async updateGroupNumbers(groupId, numbers) {
            const group = await this.getGroup(groupId);
            if (group === undefined)
                throw new Error("Tried to update numbers for unknown group");
            if (group.get('numbers').filter(n => numbers.indexOf(n) < 0).length > 0)
                throw new Error("Attempted to remove numbers from group with an UPDATE");
            /* XXX Use a Set() object and make this simpler/faster. */
            const added = numbers.filter(n => group.get('numbers').indexOf(n) < 0);
            const newNumbers = this.addGroupNumbers(groupId, added);
            if (numbers.filter(n => newNumbers.indexOf(n) < 0).length != 0 ||
                newNumbers.filter(n => numbers.indexOf(n) < 0).length != 0) {
                throw new Error("Error calculating group member difference");
            }
            return added;
        }

        async needUpdateByDeviceRegistrationId(groupId, number, encodedNumber, registrationId) {
            const group = textsecure.storage.protocol.getGroup(groupId);
            if (group === undefined)
                throw new Error("Unknown group for device registration id");
            if (group.get('numberRegistrationIds')[number] === undefined)
                throw new Error("Unknown number in group for device registration id");
            if (group.get('numberRegistrationIds')[number][encodedNumber] == registrationId)
                return false;
            var needUpdate = group.numberRegistrationIds[number][encodedNumber] !== undefined;
            group.numberRegistrationIds[number][encodedNumber] = registrationId;
            await this.putGroup(groupId, group);
            return needUpdate;
        }
    };
})();
