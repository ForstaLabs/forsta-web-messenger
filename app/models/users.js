// vim: ts=4:sw=4:expandtab
/* global md5 mnemonic QRCode */

(function () {
    'use strict';

    self.F = self.F || {};

    F.User = F.AtlasModel.extend({
        urn: '/v1/user/',
        readCacheTTL: 3600,

        toString: function() {
            return `<User id:${this.id} ${this.getTagSlug(/*full*/ true)}>`;
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

        getAvatar: async function(options) {
            options = options || {};
            return {
                id: this.id,
                link: !options.nolink,
                url: await this.getAvatarURL(options),
                title: this.getName(),
                color: this.getColor(),
                identityException: !!this.get('proposedIdentityKey')
            };
        },

        getAvatarURL: async function(options) {
            if (this.get('pending')) {
                return await F.util.textAvatarURL('📲', '#444', null, options);
            }
            const hash = this.get('gravatar_hash') ||
                         md5((this.get('email') || '').trim().toLowerCase());
            return await F.util.gravatarURL(hash, options) ||
                   await F.util.textAvatarURL(this.getInitials(), this.getColor(), null, options);
        },

        getColor: function() {
            return F.util.pickColor(this.id);
        },

        getOrg: async function() {
            return await F.atlas.getOrg(this.get('org').id);
        },

        getTagSlug: function(forceFull) {
            const tag = this.get('tag');
            if (!tag || !tag.slug) {
                return;
            } else {
                const org = this.get('org');
                const curOrg = F.currentUser && F.currentUser.get('org').id;
                if (org && (forceFull || org.id !== curOrg)) {
                    return `@${tag.slug}:${org.slug}`;
                } else {
                    return `@${tag.slug}`;
                }
            }
        },

        getIdentityKey: async function(proposed) {
            // The proposed identity key is an unaccepted key that the user has yet
            // to approve of.  While this property exists on the contact they are considered
            // to be untrustworthy.
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
            const identMnemonic = await mnemonic.Mnemonic.fromSeed(identKey);
            return identMnemonic.phrase.split(' ');
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

        getIdentityQRCode: async function(options, size) {
            size = size || 384;
            const words = await this.getIdentityWords();
            const el = document.createElement('div');
            const qr = new QRCode(el, Object.assign({
                text: words.join(' '),
                width: size,
                height: size,
            }, options));
            return qr._oDrawing._elCanvas.toDataURL();
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

        updateTrustedIdentity: async function(proposed) {
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
        },

        destroyTrustedIdentity: async function() {
            const trust = new F.TrustedIdentity({id: this.id});
            await trust.destroy();
            await this.save({proposedIdentityKey: undefined});
        }
    });

    F.UserCollection = F.AtlasCollection.extend({
        model: F.User,
        urn: '/v1/user/?user_type=PERSON',
        readCacheTTL: 3600
    });
})();
