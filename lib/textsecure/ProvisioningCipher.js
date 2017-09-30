(function() {
    'use strict';

    const ns = self.textsecure = self.textsecure || {};

    ns.ProvisioningCipher = class ProvisioningCipher {

        async decrypt(provisionEnvelope) {
            const masterEphemeral = provisionEnvelope.publicKey.toArrayBuffer();
            const message = provisionEnvelope.body.toArrayBuffer();
            if (new Uint8Array(message)[0] != 1) {
                throw new Error("Bad version number on ProvisioningMessage");
            }
            const iv = message.slice(1, 16 + 1);
            const mac = message.slice(message.byteLength - 32, message.byteLength);
            const ivAndCiphertext = message.slice(0, message.byteLength - 32);
            const ciphertext = message.slice(16 + 1, message.byteLength - 32);
            const ecRes = libsignal.Curve.calculateAgreement(masterEphemeral, this.keyPair.privKey);
            const keys = await libsignal.HKDF.deriveSecrets(ecRes, new ArrayBuffer(32),
                "TextSecure Provisioning Message");
            await libsignal.crypto.verifyMAC(ivAndCiphertext, keys[1], mac, 32);
            const plaintext = await libsignal.crypto.decrypt(keys[0], ciphertext, iv);
            const provisionMessage = ns.protobuf.ProvisionMessage.decode(plaintext);
            const privKey = provisionMessage.identityKeyPrivate.toArrayBuffer();
            return {
                identityKeyPair: libsignal.Curve.createKeyPair(privKey),
                addr: provisionMessage.addr,
                provisioningCode: provisionMessage.provisioningCode,
                userAgent: provisionMessage.userAgent
            };
        }

        getPublicKey() {
            if (!this.keyPair) {
                this.keyPair = libsignal.Curve.generateKeyPair();
            }
            return this.keyPair.pubKey;
        }
    };
})();
