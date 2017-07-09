// vim: ts=4:sw=4:expandtab
/* global dcodeIO, stringObject */

/* Extend the builtin set type with intersection methods. */
class ESet extends Set {
    isSuperset(subset) {
        for (const elem of subset) {
            if (!this.has(elem)) {
                return false;
            }
        }
        return true;
    }

    union(setB) {
        const union = new ESet(this);
        for (const elem of setB) {
            union.add(elem);
        }
        return union;
    }

    intersection(setB) {
        const intersection = new ESet();
        for (const elem of setB) {
            if (this.has(elem)) {
                intersection.add(elem);
            }
        }
        return intersection;
    }

    difference(setB) {
        const difference = new ESet(this);
        for (const elem of setB) {
            difference.delete(elem);
        }
        return difference;
    }
}


(function() {
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
                return;
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
            const tuple = textsecure.utils.unencodeNumber(encodedNumber);
            const number = tuple[0];
            const deviceId = parseInt(tuple[1]);
            const session = new Session({id: encodedNumber});
            await session.fetch({not_found_error: false});
            await session.save({record, deviceId, number});
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
            await sessions.sync('delete', sessions, {});
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
            } else if (!(await F.state.get('safetyNumbersApproval', true))) {
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
                    throw new Error("Attempted to overwrite a different identity key");
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
            console.assert(id, "Invalid ID");
            console.assert(attrs, "Invalid Attrs");
            const group = new Group(_.extend({id}, attrs));
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
        /* Extend basic signal protocol with TextSecure group handling. */

        async createGroup(numbers, id) {
            console.assert(numbers instanceof Array);
            if (id !== undefined) {
                const group = await this.getGroup(id);
                if (group !== undefined) {
                    throw new Error("Tried to recreate group");
                }
            } else {
                id = F.util.uuid4();
            }
            numbers = new ESet(numbers);
            numbers.add(await this.getState('number'));
            const attrs = {
                numbers: Array.from(numbers),
                numberRegistrationIds: {}
            };
            for (const n of numbers) {
                attrs.numberRegistrationIds[n] = {};
            }
            return await this.putGroup(id, attrs);
        }

        async getGroupNumbers(id) {
            const group = await this.getGroup(id);
            return group && group.get('numbers');
        }

        async removeGroupNumbers(id, removing) {
            console.assert(removing instanceof Array);
            const group = await this.getGroup(id);
            if (!group) {
                throw new Error("Group Not Found");
            }
            var me = await this.getState('number');
            if (removing.has(me)) {
                throw new Error("Cannot remove ourselves from a group, leave the group instead");
            }
            return await this._removeGroupNumbers(group, new ESet(removing));
        }

        async _removeGroupNumbers(group, removing, save) {
            const current = new ESet(group.get('numbers'));
            const groupRegIds = group.get('numberRegistrationIds');
            for (const n of current.intersection(removing)) {
                console.warn("Removing group user:", n);
                current.delete(n);
                delete groupRegIds[n];
            }
            const numbers = Array.from(current);
            if (save !== false) {
                await group.save({numbers});
            }
            return numbers;
        }

        async addGroupNumbers(id, adding) {
            console.assert(adding instanceof Array);
            const group = await this.getGroup(id);
            if (!group) {
                throw new Error("Group Not Found");
            }
            return await this._addGroupNumbers(group, new ESet(adding));
        }

        async _addGroupNumbers(group, adding, save) {
            console.assert(adding instanceof ESet);
            const current = new ESet(group.get('numbers'));
            const groupRegIds = group.get('numberRegistrationIds');
            for (const n of adding.difference(current)) {
                console.info("Adding group user:", n);
                current.add(n);
                groupRegIds[n] = {};
            }
            const numbers = Array.from(current);
            if (save !== false) {
                await group.save({numbers});
            }
            return numbers;
        }

        async deleteGroup(id) {
            return await this.removeGroup(id);
        }

        async updateGroupNumbers(id, numbers) {
            console.assert(numbers instanceof Array);
            const group = await this.getGroup(id);
            if (!group) {
                throw new Error("Group Not Found");
            }
            const updated = new ESet(numbers);
            const current = new ESet(group.get('numbers'));
            const removed = current.difference(updated);
            if (removed.size) {
                this._removeGroupNumbers(group, removed, /*save*/ false);
            }
            const added = updated.difference(current);
            if (added.size) {
                this._addGroupNumbers(group, added, /*save*/ false);
            }
            if (removed.size || added.size) {
                await group.save({numbers});
            }
        }

        async needUpdateByDeviceRegistrationId(groupId, number, encodedNumber, registrationId) {
            const group = await this.getGroup(groupId);
            if (!group) {
                throw new Error("Group Not Found");
            }
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
