/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';
    window.Whisper = window.Whisper || {};

    Whisper.KeyVerificationView = Whisper.View.extend({
        className: 'key-verification',
        templateName: 'key_verification',
        initialize: function(options) {
            if (options.newKey) {
              this.their_key = options.newKey;
            }
            Promise.all([
                this.loadTheirKey(),
                this.loadOurKey(),
            ]).then(this.generateSecurityNumber.bind(this))
              .then(this.render.bind(this))
              .then(this.makeQRCode.bind(this));
        },
        makeQRCode: function() {
            new QRCode(this.$('.qr')[0]).makeCode(
                dcodeIO.ByteBuffer.wrap(this.our_key).toString('base64')
            );
        },
        loadTheirKey: function() {
            if (this.their_key) {
                return Promise.resolve(this.their_key);
            } else {
                return textsecure.store.loadIdentityKey(
                    this.model.id
                ).then(function(their_key) {
                    this.their_key = their_key;
                }.bind(this));
            }
        },
        loadOurKey: async function() {
            if (!this.our_key) {
                const our_number = await F.state.get('number');
                this.our_key = await textsecure.store.loadIdentityKey(our_number);
            }
            return this.our_key;
        },
        generateSecurityNumber: async function() {
            const our_number = await F.state.get('number');
            const fpgen = new libsignal.FingerprintGenerator(5200);
            this.securityNumber = await fpgen.createFor(our_number, this.our_key,
                this.model.id, this.their_key);
        },
        render_attributes: function() {
            var s = this.securityNumber;
            var chunks = [];
            for (var i = 0; i < s.length; i += 5) {
                chunks.push(s.substring(i, i+5));
            }
            var yourSafetyNumberWith = i18n(
                'yourSafetyNumberWith', this.model.getTitle()
            );
            return {
                learnMore            : i18n('learnMore'),
                their_key_unknown    : i18n('theirIdentityUnknown'),
                yourSafetyNumberWith : i18n('yourSafetyNumberWith', this.model.getTitle()),
                has_their_key        : this.their_key !== undefined,
                chunks               : chunks,
            };
        }
    });
    Whisper.KeyVerificationPanelView = Whisper.KeyVerificationView.extend({
        className: 'key-verification panel',
        templateName: 'key_verification_panel',
    });
})();
