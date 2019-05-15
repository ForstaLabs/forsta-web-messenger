// vim: ts=4:sw=4:expandtab
/* global md5 mnemonic relay */

(function () {
    'use strict';

    self.F = self.F || {};

    // This number must match all platforms/libs etc.
    const IDENT_PHRASE_HASH_ITERATIONS = 100000;

    F.User = F.AtlasModel.extend({
        urn: '/v1/user/',
        readCacheTTL: 3600,

        defaults: function() {
            return {
                updated: Date.now()
            };
        },

        toString: function() {
            return `<User id:${this.id} ${this.getTagSlug({full: true})}>`;
        },

        initialize: function() {
            this._identWordsCache = new Map();
            this.on('change:proposedIdentityKey', this.onProposedIdentityKeyChange);
        },

        save: async function(arg) {
            if (arg !== 'updated' && (!arg || !('updated' in arg))) {
                this.set('updated', Date.now(), {silent: true});
            }
            return await F.AtlasModel.prototype.save.apply(this, arguments);
        },

        onProposedIdentityKeyChange: async function(model, proposed) {
            await this._updateAvatarIdentStatus();
        },

        _updateAvatarIdentStatus: async function() {
            if (self.document) {
                const trusted = await this.isTrusted();
                const $avatars = $(`.f-avatar-image[data-user-card="${this.id}"]`);
                $avatars.toggleClass('identity-exception', trusted === false);
                $avatars.toggleClass('identity-trusted', trusted === true);
            }
        },

        getName: function() {
            const names = [];
            const f = this.get('first_name');
            const l = this.get('last_name');
            if (f) {
                names.push(f);
            }
            if (l) {
                names.push(l);
            }
            if (this.get('removed')) {
                names.push(`(Removed User)`);
            }
            return names.join(' ');
        },

        getInitials: function(count) {
            count = count || 2;
            const initials = [];
            const f = this.get('first_name');
            const m = this.get('middle_name');
            const l = this.get('last_name');
            if (f) {
                initials.push(f[0]);
            }
            if (count >= 3 && m) {
                initials.push(m[0]);
            }
            if (count >= 2 && l) {
                initials.push(l[0]);
            }
            return initials.join('').toUpperCase();
        },

        getNameTitle: function(options) {
            options = options || {};
            const link = !!options.link;
            if (link) {
                return `<a data-user-card="${this.id}">${this.getName()} (${this.getTagSlug()})</a>`;
            } else {
                return `${this.getName()} (${this.getTagSlug()})`;
            }
        },

        isTrusted: async function() {
            // The proposed identity key is an unaccepted key that the user has yet
            // to approve of.  While this property exists on the contact they are considered
            // to be untrustworthy.
            if (this.get('proposedIdentityKey')) {
                return false;
            }
            const trust = await this.getTrustedIdentity();
            if (trust !== undefined) {
                return !!trust;
            }
            return undefined;  // No trust relationship.
        },

        getAvatar: async function(options) {
            options = options || {};
            return {
                id: this.id,
                link: !options.nolink,
                allowMultiple: options.allowMultiple,
                url: await this.getAvatarURL(options),
                title: this.getName(),
                color: this.getColor(),
                trusted: await this.isTrusted(),
                removed: this.get('removed'),
            };
        },

        getAvatarURL: async function(options) {
            if (this.get('pending')) {
                return await F.util.textAvatarURL('~', '#444', null, options);
            }
            if (F.env.HAS_AVATAR_SERVICE && !this.get('removed') && F.currentUser) {
                return await F.util.userAvatarURL(this.id, options);
            } else {
                const hash = this.get('gravatar_hash') ||
                             md5((this.get('email') || '').trim().toLowerCase());
                return await F.util.gravatarURL(hash, options) ||
                       await F.util.textAvatarURL(this.getInitials(), this.getColor(), null, options);
            }
        },

        getColor: function() {
            return F.util.pickColor(this.id);
        },

        getOrg: async function() {
            return await F.atlas.getOrg(this.get('org').id);
        },

        getTag: async function() {
            return await F.atlas.getTag(this.get('tag').id);
        },

        getTagSlug: function(options) {
            options = options || {};
            const full = !!options.full;
            const link = !!options.link;
            const tag = this.get('tag');
            if (!tag || !tag.slug) {
                return;
            }
            const org = this.get('org');
            const curOrg = F.currentUser && F.currentUser.get('org').id;
            let tagSlug;
            if (org && (full || org.id !== curOrg)) {
                tagSlug = `@${tag.slug}:${org.slug}`;
            } else {
                tagSlug = `@${tag.slug}`;
            }
            return link ? `<a data-user-card="${this.id}">${tagSlug}</a>` : tagSlug;
        },

        getIdentityKey: async function(proposed) {
            if (proposed) {
                return this.get('proposedIdentityKey');
            } else {
                return await F.foundation.relayStore.getIdentityKey(this.id);
            }
        },

        getIdentityWords: async function(proposed) {
            const identKey = await this.getIdentityKey(proposed);
            if (!identKey) {
                return;
            }
            if (this._identWordsCache.has(identKey)) {
                return this._identWordsCache.get(identKey);
            }
            /*
             * 1. Make an IV from this contacts identity key.
             * 2. Generate a secure seed from this (BIP39 mnemonics are PBKDF2 based).
             * 3. Refeed the seed bits into the final Mnemonic object for user viewing.
             */
            const iv = await mnemonic.Mnemonic.fromSeed(identKey);
            const seed = await iv.toSeed(this.id, IDENT_PHRASE_HASH_ITERATIONS);
            const identMnemonic = await mnemonic.Mnemonic.fromSeed(seed);
            const words = identMnemonic.phrase.split(' ');
            this._identWordsCache.set(identKey, words);
            return words;
        },

        getIdentityPhrase: async function(proposed) {
            let words = await this.getIdentityWords(proposed);
            if (!words) {
                return;
            }
            words = words.slice(0, 9);
            return [
                words.slice(0, 3).join(' '),
                words.slice(3, 6).join(' '),
                words.slice(6, 9).join(' ')
            ].join('\n');
        },

        getTrustedIdentity: async function() {
            const trust = new F.TrustedIdentity({id: this.id});
            await trust.fetch({not_found_error: false});
            if (!trust.get('identityKey')) {
                return;
            } else {
                return trust;
            }
        },

        trustIdentity: async function(proposed) {
            const identityKey = await this.getIdentityKey(proposed);
            if (!identityKey) {
                throw TypeError("Identity key unknown");
            }
            const trust = new F.TrustedIdentity({id: this.id});
            await trust.fetch({not_found_error: false});
            const oldKey = trust.get('identityKey');
            if (oldKey && oldKey.length === identityKey.length &&
                identityKey.every((x, i) => oldKey[i] === x)) {
                console.warn("No update needed to identity key");
            } else {
                console.warn("Updating trusted identity for:", this.id);
                await trust.save({
                    identityKey,
                    updated: Date.now()
                });
            }
            await this.save({proposedIdentityKey: undefined});
            await this._updateAvatarIdentStatus();
            setTimeout(this.releaseQuarantinedMessages.bind(this), 0);
        },

        untrustIdentity: async function() {
            const trust = new F.TrustedIdentity({id: this.id});
            await trust.destroy();
            await this.save({proposedIdentityKey: undefined});
            await this._updateAvatarIdentStatus();
            setTimeout(this.releaseQuarantinedMessages.bind(this), 0);
        },

        releaseQuarantinedMessages: async function() {
            await F.queueAsync(this, this._releaseQuarantinedMessages.bind(this));
        },

        _releaseQuarantinedMessages: async function() {
            const quarantined = new F.QuarantinedMessageCollection();
            await quarantined.fetch({
                index: {
                    name: 'source',
                    only: this.id
                }
            });
            if (!quarantined.length) {
                return;
            }
            const msgRecv = F.foundation.getMessageReceiver();
            await msgRecv.idle;
            console.warn(`Releasing ${quarantined.length} messages from quarantine`);
            for (const msg of Array.from(quarantined.models)) {
                const env = relay.protobuf.Envelope.decode(msg.get('protobuf'));
                env.timestamp = msg.get('timestamp');  // Must used normalized timestamp!
                try {
                    await msgRecv.handleEnvelope(env, /*reentrant*/ false, /*forceAccept*/ true);
                } catch(e) {
                    console.error('Unquarantine Message Error:', e);
                }
                await msg.destroy();
            }
        },

        setBlocked: async function(blocked) {
            await this.save({blocked});
            const t = new F.Thread({}, {deferSetup: true});
            await t.sendSyncControl({
                control: blocked ? 'blocked' : 'unblocked',
                userId: this.id
            });
        }
    });

    F.UserCollection = F.AtlasCollection.extend({
        model: F.User,
        urn: '/v1/user/?user_type=PERSON',
        readCacheTTL: 3600
    });
})();
