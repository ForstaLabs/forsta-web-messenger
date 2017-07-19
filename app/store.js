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

        async loadIdentityKey(identifier) {
            if (identifier === null || identifier === undefined) {
                throw new Error("Tried to get identity key for undefined/null key");
            }
            const addr = textsecure.utils.unencodeAddr(identifier)[0];
            const identityKey = new IdentityKey({id: addr});
            // XXX cache!?
            await identityKey.fetch();
            return identityKey.get('publicKey');
        }

        async saveIdentity(identifier, publicKey) {
            if (identifier === null || identifier === undefined) {
                throw new Error("Tried to put identity key for undefined/null key");
            }
            if (!(publicKey instanceof ArrayBuffer)) {
                publicKey = convertToArrayBuffer(publicKey);
            }
            const addr = textsecure.utils.unencodeAddr(identifier)[0];
            const identityKey = new IdentityKey({id: addr});
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

        async getGroup(id) {
            if (id === null || id === undefined) {
                throw new Error("Tried to get group for undefined/null id");
            }
            const group = new Group({id});
            try {
                // XXX cache!?
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

        async createGroup(addrs, id) {
            console.assert(addrs instanceof Array);
            console.assert(id);
            const group = await this.getGroup(id);
            if (group !== undefined) {
                console.error("Group already exists for:", id);
                throw new Error("Tried to recreate group");
            }
            addrs = new F.util.ESet(addrs);
            addrs.add(await this.getState('addr'));
            const attrs = {
                addrs: Array.from(addrs),
                addrRegistrationIds: {}
            };
            for (const n of addrs) {
                attrs.addrRegistrationIds[n] = {};
            }
            console.info("Created group:", id, addrs);
            return await this.putGroup(id, attrs);
        }

        async getGroupAddrs(id) {
            const group = await this.getGroup(id);
            return group && group.get('addrs');
        }

        async removeGroupAddrs(id, removing) {
            console.assert(removing instanceof Array);
            const group = await this.getGroup(id);
            if (!group) {
                console.error("Cannot remove nonexistent group:", id);
                throw new Error("Group Not Found");
            }
            var me = await this.getState('addr');
            if (removing.indexOf(me) !== -1) {
                throw new Error("Cannot remove ourself from a group, leave the group instead");
            }
            return await this._removeGroupAddrs(group, new F.util.ESet(removing));
        }

        async _removeGroupAddrs(group, removing, save) {
            const current = new F.util.ESet(group.get('addrs'));
            const groupRegIds = group.get('addrRegistrationIds');
            for (const n of current.intersection(removing)) {
                console.warn("Removing group address", n, 'from', group.id);
                current.delete(n);
                delete groupRegIds[n];
            }
            const addrs = Array.from(current);
            if (save !== false) {
                await group.save({addrs});
            }
            return addrs;
        }

        async addGroupAddrs(id, adding) {
            console.assert(adding instanceof Array);
            const group = await this.getGroup(id);
            if (!group) {
                console.error("Cannot add address to nonexistent group:", id);
                throw new Error("Group Not Found");
            }
            return await this._addGroupAddrs(group, new F.util.ESet(adding));
        }

        async _addGroupAddrs(group, adding, save) {
            console.assert(adding instanceof F.util.ESet);
            const current = new F.util.ESet(group.get('addrs'));
            const groupRegIds = group.get('addrRegistrationIds');
            for (const n of adding.difference(current)) {
                console.info("Adding group addres", n, 'to', group.id);
                current.add(n);
                groupRegIds[n] = {};
            }
            const addrs = Array.from(current);
            if (save !== false) {
                await group.save({addrs});
            }
            return addrs;
        }

        async deleteGroup(id) {
            console.warn("Deleting group:", id);
            return await this.removeGroup(id);
        }

        async updateGroupAddrs(id, addrs) {
            console.assert(addrs instanceof Array);
            const group = await this.getGroup(id);
            if (!group) {
                console.error("Cannot update nonexistent group:", id);
                throw new Error("Group Not Found");
            }
            const updated = new F.util.ESet(addrs);
            const current = new F.util.ESet(group.get('addrs'));
            const removed = current.difference(updated);
            if (removed.size) {
                this._removeGroupAddrs(group, removed, /*save*/ false);
            }
            const added = updated.difference(current);
            if (added.size) {
                this._addGroupAddrs(group, added, /*save*/ false);
            }
            if (removed.size || added.size) {
                await group.save({addrs});
            }
            return addrs;
        }

        async needUpdateByDeviceRegistrationId(groupId, addr, encodedAddr, registrationId) {
            const group = await this.getGroup(groupId);
            if (!group) {
                throw new Error("Group Not Found");
            }
            if (group.get('addrRegistrationIds')[addr] === undefined)
                throw new Error("Unknown addr in group for device registration id");
            if (group.get('addrRegistrationIds')[addr][encodedAddr] == registrationId)
                return false;
            var needUpdate = group.addrRegistrationIds[addr][encodedAddr] !== undefined;
            group.addrRegistrationIds[addr][encodedAddr] = registrationId;
            await this.putGroup(groupId, group);
            return needUpdate;
        }
    };
})();
