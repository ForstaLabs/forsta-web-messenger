// vim: ts=4:sw=4:expandtab
/* global libsignal */

(function(){
    'use strict';

    const ns = self.relay = self.relay || {};

    ns.crypto = {
        decryptWebsocketMessage: async function(message, signaling_key) {
            const decodedMessage = message.toArrayBuffer();

            if (signaling_key.byteLength != 52) {
                throw new Error("Got invalid length signaling_key");
            }
            if (decodedMessage.byteLength < 1 + 16 + 10) {
                throw new Error("Got invalid length message");
            }
            if (new Uint8Array(decodedMessage)[0] != 1) {
                throw new Error("Got bad version number: " + decodedMessage[0]);
            }

            const aes_key = signaling_key.slice(0, 32);
            const mac_key = signaling_key.slice(32, 32 + 20);

            const iv = decodedMessage.slice(1, 1 + 16);
            const ciphertext = decodedMessage.slice(1 + 16, decodedMessage.byteLength - 10);
            const ivAndCiphertext = decodedMessage.slice(0, decodedMessage.byteLength - 10);
            const mac = decodedMessage.slice(decodedMessage.byteLength - 10, decodedMessage.byteLength);

            await libsignal.crypto.verifyMAC(ivAndCiphertext, mac_key, mac, 10);
            return await libsignal.crypto.decrypt(aes_key, ciphertext, iv);
        },

        decryptAttachment: async function(encryptedBin, keys) {
            if (keys.byteLength != 64) {
                throw new Error("Got invalid length attachment keys");
            }
            if (encryptedBin.byteLength < 16 + 32) {
                throw new Error("Got invalid length attachment");
            }

            const aes_key = keys.slice(0, 32);
            const mac_key = keys.slice(32, 64);

            const iv = encryptedBin.slice(0, 16);
            const ciphertext = encryptedBin.slice(16, encryptedBin.byteLength - 32);
            const ivAndCiphertext = encryptedBin.slice(0, encryptedBin.byteLength - 32);
            const mac = encryptedBin.slice(encryptedBin.byteLength - 32, encryptedBin.byteLength);

            await libsignal.crypto.verifyMAC(ivAndCiphertext, mac_key, mac, 32);
            return await libsignal.crypto.decrypt(aes_key, ciphertext, iv);
        },

        encryptAttachment: async function(plaintext, keys, iv) {
            if (keys.byteLength != 64) {
                throw new Error("Got invalid length attachment keys");
            }
            if (iv.byteLength != 16) {
                throw new Error("Got invalid length attachment iv");
            }
            const aes_key = keys.slice(0, 32);
            const mac_key = keys.slice(32, 64);

            const ciphertext = await libsignal.crypto.encrypt(aes_key, plaintext, iv);
            const ivAndCiphertext = new Uint8Array(16 + ciphertext.byteLength);
            ivAndCiphertext.set(new Uint8Array(iv));
            ivAndCiphertext.set(new Uint8Array(ciphertext), 16);

            const mac = await libsignal.crypto.calculateMAC(mac_key, ivAndCiphertext.buffer);
            const encryptedBin = new Uint8Array(16 + ciphertext.byteLength + 32);
            encryptedBin.set(ivAndCiphertext);
            encryptedBin.set(new Uint8Array(mac), 16 + ciphertext.byteLength);
            return encryptedBin.buffer;
        },

        getRandomBytes: function(size) {
            return libsignal.crypto.getRandomBytes(size);
        }
    };
})();
