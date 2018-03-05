(function() {
    'use strict';

    const ns = self.mnemonic = self.mnemonic || {};

    //var BN = bitcore.crypto.BN; // XXX
    //var unorm = require('unorm'); // XXX
    //var _ = bitcore.deps._; // XXX

    //var Hash = bitcore.crypto.Hash; // XXX

    //var $ = bitcore.util.preconditions;

    ns.MnemonicError = class MnemonicError extends Error {};

    ns.InvalidEntropy = class InvalidEntropy extends ns.MnemonicError {};

    ns.UnknownWordlist = class UnknownWordlist extends ns.MnemonicError {};

    ns.InvalidMnemonic = class InvalidMnemonic extends ns.MnemonicError {};

    /**
     * This is an immutable class that represents a BIP39 Mnemonic code.
     * See BIP39 specification for more info: https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki
     * A Mnemonic code is a a group of easy to remember words used for the generation
     * of deterministic wallets. A Mnemonic can be used to generate a seed using
     * an optional passphrase, for later generate a HDPrivateKey.
     *
     * @example
     * // generate a random mnemonic
     * var mnemonic = new Mnemonic();
     * var phrase = mnemonic.phrase;
     *
     * // use a different language
     * var mnemonic = new Mnemonic(Mnemonic.Words.SPANISH);
     * var xprivkey = mnemonic.toHDPrivateKey();
     *
     * @param {*=} data - a seed, phrase, or entropy to initialize (can be skipped)
     * @param {Array=} wordlist - the wordlist to generate mnemonics from
     * @returns {Mnemonic} A new instance of Mnemonic
     * @constructor
     */
    ns.Mnemonic = class Mnemonic {

        static async factory (data, wordlist) {
            if (data instanceof Array) {
                wordlist = data;
                data = null;
            }

            // handle data overloading
            var ent, phrase, seed;
            if (data instanceof Uint8Array) {
                seed = data;
            } else if (typeof data === 'string') {
                //phrase = unorm.nfkd(data); // XXX
                phrase = data;
            } else if (typeof data === 'number') {
                ent = data;
            } else if (data) {
                throw new TypeError('Must be a Uint8Array, a string or an integer');
            }
            ent = ent || 128;

            // check and detect wordlist
            wordlist = wordlist || this._getDictionary(phrase);
            if (phrase && !wordlist) {
                throw new ns.UnknownWordlist(phrase);
            }
            wordlist = wordlist || ns.words.ENGLISH;

            if (seed) {
                phrase = await this._entropy2mnemonic(seed, wordlist);
            }

            // validate phrase and ent
            if (phrase && !(await this.isValid(phrase, wordlist))) {
                throw new ns.InvalidMnemonic(phrase);
            }
            if (ent % 32 !== 0 || ent < 128) {
                throw new TypeError('Values must be ENT > 128 and ENT % 32 == 0');
            }

            phrase = phrase || await this._mnemonic(ent, wordlist);

            const instance = new this();

            Object.defineProperty(instance, 'wordlist', {
                configurable: false,
                value: wordlist
            });
            Object.defineProperty(instance, 'phrase', {
                configurable: false,
                value: phrase
            });

            return instance;
        }

        /**
         * Will return a boolean if the mnemonic is valid
         *
         * @example
         *
         * var valid = Mnemonic.isValid('lab rescue lunch elbow recall phrase perfect donkey biology guess moment husband');
         * // true
         *
         * @param {String} mnemonic - The mnemonic string
         * @param {String} [wordlist] - The wordlist used
         * @returns {boolean}
         */
        static async isValid(mnemonic, wordlist) {
            //mnemonic = unorm.nfkd(mnemonic); // XXX 
            wordlist = wordlist || this._getDictionary(mnemonic);

            if (!wordlist) {
                return false;
            }

            var words = mnemonic.split(' ');
            var bin = '';
            for (var i = 0; i < words.length; i++) {
                var ind = wordlist.indexOf(words[i]);
                if (ind < 0) return false;
                bin = bin + ('00000000000' + ind.toString(2)).slice(-11);
            }

            var cs = bin.length / 33;
            var hash_bits = bin.slice(-cs);
            var nonhash_bits = bin.slice(0, bin.length - cs);
            var buf = new Uint8Array(nonhash_bits.length / 8);
            for (i = 0; i < nonhash_bits.length / 8; i++) {
                buf[i] = parseInt(bin.slice(i * 8, (i + 1) * 8), 2);
            }
            var expected_hash_bits = await this._entropyChecksum(buf);
            return expected_hash_bits === hash_bits;
        }

        /**
         * Internal function to check if a mnemonic belongs to a wordlist.
         *
         * @param {String} mnemonic - The mnemonic string
         * @param {String} wordlist - The wordlist
         * @returns {boolean}
         */
        static _belongsToWordlist(mnemonic, wordlist) {
            //var words = unorm.nfkd(mnemonic).split(' '); // XXX
            return mnemonic.split(' ').every(x => wordlist.indexOf(x) !== -1);
        }

        /**
         * Internal function to detect the wordlist used to generate the mnemonic.
         *
         * @param {String} mnemonic - The mnemonic string
         * @returns {Array} the wordlist or null
         */
        static _getDictionary(mnemonic) {
            if (!mnemonic) return null;

            var dicts = Object.keys(ns.words);
            for (var i = 0; i < dicts.length; i++) {
                var key = dicts[i];
                if (this._belongsToWordlist(mnemonic, ns.words[key])) {
                    return ns.words[key];
                }
            }
            return null;
        }

        /**
         * Will generate a seed based on the mnemonic and optional passphrase.
         *
         * @param {String} [passphrase]
         * @returns {Uint8Array}
         */
        async toSeed(passphrase) {
            // XXX
            const keyData = (new TextEncoder()).encode(this.phrase);
            const key = await crypto.subtle.importKey('raw', keyData, {name: 'PBKDF2'}, false, ['deriveBits']);
            //return pbkdf2(unorm.nfkd(this.phrase), unorm.nfkd('mnemonic' + passphrase), 2048, 64);
            const salt = (new TextEncoder()).encode('mnemonic' + (passphrase || ''));
            const bits = await crypto.subtle.deriveBits({
                name: "PBKDF2",
                salt,
                iterations: 2048,
                hash: {name: 'SHA-512'},
            }, key, 512);
            return new Uint8Array(bits);
        }

        /**
         * Will generate a Mnemonic object based on a seed.
         *
         * @param {Uint8Array} [seed]
         * @param {string} [wordlist]
         * @returns {Mnemonic}
         */
        static async fromSeed(seed, wordlist) {
            if (!(seed instanceof Uint8Array)) {
                throw TypeError('seed must be a Uint8Array');
            }
            return await this.factory(seed, wordlist);
        }

        /**
         *
         * Generates a HD Private Key from a Mnemonic.
         * Optionally receive a passphrase and bitcoin network.
         *
         * @param {String=} [passphrase]
         * @param {Network|String|number=} [network] - The network: 'livenet' or 'testnet'
         * @returns {HDPrivateKey}
         */
        toHDPrivateKey(passphrase, network) {
            throw new Error('Not Implemented'); // XXX
            //var seed = this.toSeed(passphrase); // XXX
            //return bitcore.HDPrivateKey.fromSeed(seed, network); // XXX
        }

        /**
         * Will return a the string representation of the mnemonic
         *
         * @returns {String} Mnemonic
         */
        toString() {
            return this.phrase;
        }

        /**
         * Will return a string formatted for the console
         *
         * @returns {String} Mnemonic
         */
        inspect() {
            return '<Mnemonic: ' + this.toString() + ' >';
        }

        /**
         * Internal function to generate a random mnemonic
         *
         * @param {Number} ENT - Entropy size, defaults to 128
         * @param {Array} wordlist - Array of words to generate the mnemonic
         * @returns {String} Mnemonic string
         */
        static async _mnemonic(ENT, wordlist) {
            const buf = new Uint8Array(ENT / 8);
            crypto.getRandomValues(buf);
            return await this._entropy2mnemonic(buf, wordlist);
        }

        /**
         * Internal function to generate mnemonic based on entropy
         *
         * @param {Number} entropy - Entropy buffer
         * @param {Array} wordlist - Array of words to generate the mnemonic
         * @returns {String} Mnemonic string
         */
        static async _entropy2mnemonic(entropy, wordlist) {
            const bin = this._bufferToBinary(entropy) + await this._entropyChecksum(entropy);
            //if (bin.length % 11 !== 0) {
            //    throw new ns.InvalidEntropy(bin);
            //}
            const mnemonic = [];
            for (let i = 0; i < bin.length / 11; i++) {
                var wi = parseInt(bin.slice(i * 11, (i + 1) * 11), 2);
                mnemonic.push(wordlist[wi]);
            }
            var ret;
            if (wordlist === ns.words.JAPANESE) {
                ret = mnemonic.join('\u3000');
            } else {
                ret = mnemonic.join(' ');
            }
            return ret;
        }

        /**
         * Internal function to create checksum of entropy
         *
         * @param entropy
         * @returns {string} Checksum of entropy length / 32
         * @private
         */
        static async _entropyChecksum(entropy) {
            const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', entropy));
            return this._bufferToBinary(hash).slice(0, entropy.length * 8 / 32);
        }

        static _bufferToBinary(buf) {
            const bits = [];
            for (const n of buf) {
                const b = n.toString(2);
                bits.push('00000000'.slice(b.length) + b);
            }
            return bits.join('');
        }
    };
})();
