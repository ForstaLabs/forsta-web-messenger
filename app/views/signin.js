// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    F.SigninView = F.View.extend({

        splashImages: [
            'pexels-photo-desktop.jpeg',
            'pexels-photo-desktop_texting.jpeg',
            'pexels-photo-taking_picture.jpeg',
            'pexels-photo-texting-work.jpeg',
            'pexels-photo-texting.jpeg',
            'pexels-photo-texting2.jpeg',
            'pexels-photo-texting3.jpeg',
            'pexels-photo-texting4.jpeg',
            'pexels-photo-texting5.jpeg',
            'pexels-photo-texting6.jpeg',
            'pexels-photo-texting7.jpeg',
            'pexels-photo-texting8.jpeg',
            'pexels-photo-texting9.jpeg',
            'pexels-photo-texting_hiptser.jpeg'
        ],

        events: {
            'click .back.button': 'onBackClick',
            'click .f-new-username.button': 'onEnterNewUsernameClick',
            'click .f-select-username .ui.list .item': 'onKnownUserClick',
            'click .f-select-username .ui.list .item .close': 'onKnownUserCloseClick',
            'click .f-forgot.password a': 'onForgotPasswordClick',
        },

        initialize: function() {
            relay.hub.setAtlasUrl(F.env.ATLAS_URL);
            this._pageHistory = [];
        },

        populateKnownUsers: async function() {
            const $list = this.$('.f-select-username .ui.list');
            this.knownUsers = this.getKnownUsers();
            const items = await Promise.all(this.knownUsers.map(async x =>
                `<div data-id="${x.id}" class="item"
                      title="Last login ${F.tpl.help.fromnow(x.get('lastLogin'))}">` +
                    `<img class="ui avatar image" src="${await x.getAvatarURL()}"/>` +
                     `<div class="content">` +
                        `<div class="header">${x.getName()}</div>` +
                        `<small class="description">${x.getTagSlug()}</small>` +
                     `</div>` +
                     `<i class="icon close" title="Forget this user"></i>` +
                `</div>`));
            $list.html(items.join(''));
        },

        getKnownUsers: function() {
            const data = JSON.parse(localStorage.getItem('knownUsers') || '[]');
            data.sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
            return data.map(x => new F.Contact(x));
        },

        saveKnownUsers: function(users) {
            localStorage.setItem('knownUsers', JSON.stringify(users.map(x => x.attributes)));
        },

        rememberKnownUser: function(contact) {
            const users = this.getKnownUsers().filter(x => x.id !== contact.id);
            contact.set('lastLogin', Date.now());
            users.push(contact);
            this.saveKnownUsers(users);
        },

        forgetKnownUser: function(id) {
            const users = this.getKnownUsers();
            this.saveKnownUsers(users.filter(x => x.id !== id));
        },

        login: async function(credentials) {
            const auth = await relay.hub.fetchAtlas('/v1/login/', {
                skipAuth: true,
                method: 'POST',
                json: credentials
            });
            this.rememberKnownUser(new F.Contact(auth.user));
            F.atlas.saveAuth(auth.token);
            location.assign(F.urls.main);
            await relay.util.never();
        },

        render: async function() {
            this.rotateBackdrop();  // bg only
            await this.populateKnownUsers();
            if (this.knownUsers.length) {
                this.selectPage('.f-select-username');
            } else {
                this.selectPage('.f-manual-username');
            }
            await F.View.prototype.render.apply(this, arguments);
            this.bindUsernameForm();
            this.bindLegacySMSForm();
            this.bindPasswordForm();
            this.bindTOTPForm();
            return this;
        },

        parseFetchError: function(e) {
            if (e.code === 429) {
                return e.content.detail;
            } else if (e.contentType === 'json') {
                if (e.content.non_field_errors) {
                    return e.content.non_field_errors.join('<br/>');
                } else if (e.content.password) {
                    return e.content.password.join('<br/>');
                } else if (e.content.otp) {
                    return e.content.otp.join('<br/>');
                } else {
                    console.warn("Unhandled JSON error response", e);
                    return JSON.stringify(e.content, null, 2);
                }
            } else {
                console.error("Unhandled error response", e);
                return e.toString();
            }
        },

        bindUsernameForm: function() {
            const $page = this.$('.f-manual-username');
            const $form = $page.find('.ui.form');
            const $submit = $form.find('.submit');
            const $error = $form.find('.error.message');
            $page.on('selected', () => {
                $error.empty().removeClass('visible');
            });
            $form.form({
                on: 'change',
                fields: {
                    username: {
                        identifier: 'forsta-username',
                        rules: [{
                            type: 'empty',
                        }, {
                            type: 'regExp',
                            value: /^@?[a-z0-9]+[a-z0-9._]*(:[a-z0-9]+[a-z0-9._]*)?$/i,
                            prompt: 'This is not a properly formatted username; ' +
                                    'A valid username looks like "@user:org"'
                        }]
                    }
                },
                onValid: function() {
                    const $field = this;
                    $field.attr('title', '');
                    $submit.removeClass('disabled');
                },
                onInvalid: function(errors) {
                    const $field = this;
                    $field.attr('title', errors.join('\n'));
                    $submit.addClass('disabled');
                },
                onSuccess: () => {
                    (async () => {
                        const username = $form.form('get value', 'forsta-username').toLowerCase();
                        let [user, org] = username.replace(/^@/, '').split(':');
                        org = org || 'forsta';
                        $submit.addClass('loading disabled');
                        try {
                            await this.applyAuthStep(user, org);
                        } catch(e) {
                            $error.html(this.parseFetchError(e)).addClass('visible');
                            return;
                        } finally {
                            $submit.removeClass('loading disabled');
                        }
                    })();
                    return false; // prevent page reload.
                }
            });
        },

        bindLegacySMSForm: function() {
            const $page = this.$('.sms.validate.page');
            const $form = $page.find('.ui.form');
            const $submit = $form.find('.submit');
            const $error = $form.find('.error.message');
            $page.on('selected', (ev, challenges) => {
                $form.form('reset');
                $error.empty().removeClass('visible');
            });
            $form.form({
                on: 'change',
                fields: {
                    auth_code: {
                        identifier: 'forsta-sms-code',
                        rules: [{
                            type: 'empty',
                        }, {
                            type: 'regExp',
                            value: /^[0-9]{0,6}$/,
                            prompt: 'Code must be the 6 digit number you recieved via SMS.'
                        }]
                    }
                },
                onValid: function() {
                    const $field = this;
                    $field.attr('title', '');
                    $submit.toggleClass('disabled', $field.val().length !== 6);
                },
                onInvalid: function(errors) {
                    const $field = this;
                    $field.attr('title', errors.join('\n'));
                    $submit.addClass('disabled');
                },
                onSuccess: () => {
                    (async () => {
                        const code = $form.form('get value', 'forsta-sms-code');
                        const authtoken = [this.currentLogin.org, this.currentLogin.user, code].join(':');
                        $submit.addClass('loading disabled');
                        $error.empty().removeClass('visible');
                        try {
                            await this.login({authtoken});
                        } catch(e) {
                            $submit.removeClass('loading disabled');
                            $error.html(this.parseFetchError(e)).addClass('visible');
                        }
                    })();
                    return false; // prevent page reload.
                }
            });
        },

        bindPasswordForm: function() {
            const $page = this.$('.password.validate.page');
            const $form = $page.find('.ui.form');
            const $submit = $form.find('.submit');
            const $error = $form.find('.error.message');
            $page.on('selected', (ev, challenges) => {
                const username = `@${this.currentLogin.user}:${this.currentLogin.org}`;
                $form.form('reset');
                $form.form('set value', 'forsta-username', username);
                $page.toggleClass('has-next', !(challenges.size === 1));
                $error.empty().removeClass('visible');
            });
            $form.form({
                on: 'change',
                fields: {
                    password: {
                        identifier: 'forsta-password',
                        rules: [{
                            type: 'empty'
                        }]
                    }
                },
                onValid: function() {
                    const $field = this;
                    $field.attr('title', '');
                    $submit.toggleClass('disabled', !$field.val());
                },
                onInvalid: function(errors) {
                    const $field = this;
                    $field.attr('title', errors.join('\n'));
                    $submit.addClass('disabled');
                },
                onSuccess: () => {
                    (async () => {
                        const password = $form.form('get value', 'forsta-password');
                        const fq_tag = `@${this.currentLogin.user}:${this.currentLogin.org}`;
                        $submit.addClass('loading disabled');
                        try {
                            await this.login({fq_tag, password});
                        } catch(e) {
                            $submit.removeClass('loading disabled');
                            const content = e.content || {};
                            if (e.code === 400 && content.otp && !content.password) {
                                this.selectPage('.validate.totp.page', password);
                            } else {
                                $error.html(this.parseFetchError(e)).addClass('visible');
                            }
                        }
                    })();
                    return false; // prevent page reload.
                }
            });
        },

        bindTOTPForm: function() {
            const $page = this.$('.totp.validate.page');
            const $form = $page.find('.ui.form');
            const $submit = $form.find('.submit');
            const $error = $form.find('.error.message');
            $page.on('selected', (ev, password) => {
                const username = `@${this.currentLogin.user}:${this.currentLogin.org}`;
                $form.form('reset');
                $form.form('set value', 'forsta-username', username);
                $form.form('set value', 'forsta-password', password);
                $error.empty().removeClass('visible');
            });
            $form.form({
                on: 'change',
                fields: {
                    auth_code: {
                        identifier: 'forsta-totp-code',
                        rules: [{
                            type: 'empty',
                        }, {
                            type: 'regExp',
                            value: /^[0-9]{0,6}$/,
                            prompt: 'Code must be the 6 digit number from your two-factor device ' +
                                    '(e.g. Google Authenticator, etc.).'
                        }]
                    }
                },
                onValid: function() {
                    const $field = this;
                    $field.attr('title', '');
                    $submit.toggleClass('disabled', !$field.val());
                },
                onInvalid: function(errors) {
                    const $field = this;
                    $field.attr('title', errors.join('\n'));
                    $submit.addClass('disabled');
                },
                onSuccess: () => {
                    (async () => {
                        const fq_tag = `@${this.currentLogin.user}:${this.currentLogin.org}`;
                        const password = $form.form('get value', 'forsta-password');
                        const otp = $form.form('get value', 'forsta-totp-code');
                        $submit.addClass('loading disabled');
                        try {
                            await this.login({fq_tag, password, otp});
                        } catch(e) {
                            $submit.removeClass('loading disabled');
                            $error.html(this.parseFetchError(e)).addClass('visible');
                        }
                    })();
                    return false; // prevent page reload.
                }
            });
        },

        applyAuthStep: async function(user, org) {
            F.assert(user && typeof user === 'string');
            F.assert(org && typeof org === 'string');
            F.assert(user.indexOf('@') === -1);
            const challenges = await this.authRequest(user, org);
            this.currentLogin = {user, org};
            if (challenges.has('sms')) {
                F.assert(challenges.size === 1);
                this.selectPage(`.page.validate.sms`);
            } else if (challenges.has('password')) {
                this.selectPage(`.page.validate.password`, challenges);
            } else {
                throw new TypeError("Unexpected challenge type(s): " + Array.from(challenges));
            }
        },

        onBackClick: function() {
            this._pageHistory.pop();  // skip current.
            const args = this._pageHistory.pop();
            this.selectPage.apply(this, args);
        },

        onEnterNewUsernameClick: function() {
            this.selectPage('.f-manual-username');
        },

        onKnownUserClick: async function(ev) {
            const id = ev.currentTarget.dataset.id;
            const user = this.knownUsers.filter(x => x.id === id)[0];
            const $error = this.$('.f-select-username .error.message');
            const $loading = this.$('.f-select-username .ui.dimmer');
            $error.empty().removeClass('visible');
            $loading.dimmer('show');
            try {
                await this.applyAuthStep(user.get('tag').slug, user.get('org').slug);
            } catch(e) {
                $error.html(this.parseFetchError(e)).addClass('visible');
                return;
            } finally {
                $loading.dimmer('hide');
            }
        },

        onKnownUserCloseClick: function(ev) {
            const id = $(ev.currentTarget).closest('.item').data('id');
            this.forgetKnownUser(id);
            this.render();
            return false;
        },

        onForgotPasswordClick: async function(ev) {
            ev.preventDefault();
            const url = `/v1/password/reset/`;
            const fq_tag = `@${this.currentLogin.user}:${this.currentLogin.org}`;
            let resp;
            try {
                resp = await relay.hub.fetchAtlas(url, {
                    method: 'POST',
                    skipAuth: true,
                    json: {fq_tag}
                });
            } catch(e) {
                const error = e.content ? JSON.stringify(e.content, null, 2) : e.toString();
                await F.util.promptModal({
                    icon: 'red warning sign',
                    header: "Password Reset Error",
                    content: `Failed to send password reset message:` +
                             `<div class="json">${error}</div>`
                });
                return;
            }
            const icon = resp.method === 'email' ? 'envelope' : 'phone';
            await F.util.promptModal({
                icon,
                size: 'tiny',
                header: "Password Reset Message Sent",
                content: `A password reset ${resp.method} is on its way.`
            });
        },

        selectPage: async function(selector, args) {
            this._pageHistory.push(arguments);
            const $page = this.$(selector);
            $page.addClass('active').siblings('.page').removeClass('active');
            await F.util.animationFrame();
            $page.find('input.focus').focus();
            $page.trigger('selected', args);
        },

        authRequest: async function(user, org) {
            const url = `/v1/login/send/${org}/${user}/`;
            const challenges = new Set();
            try {
                await relay.hub.fetchAtlas(url, {skipAuth: true});
            } catch(e) {
                const errors = new Set(e.content.non_field_errors);
                if (e.code === 409) {
                    if (errors.has('password auth required')) {
                        challenges.add('password');
                    }
                    if (errors.has('totp auth required')) {
                        challenges.add('totp');
                    }
                    return challenges;
                } else {
                    throw e;
                }
            }
            challenges.add('sms');
            return challenges;
        },

        rotateBackdrop: async function() {
            while (true) {
                if (!this.$('.f-splash.column').is(':visible')) {
                    await relay.util.sleep(1);
                    continue;
                }
                const img = this.splashImages[Math.floor(Math.random() * this.splashImages.length)];
                const url = URL.createObjectURL(await F.util.fetchStaticBlob('images/' + img));
                const $curBack = this.$('.f-splash .backdrop');
                const $newBack = $('<div class="backdrop" style="opacity: 0"></div>');
                $newBack.css('background-image', `url('${url}')`);
                $newBack[0].bgUrl = url;
                $curBack.before($newBack);
                await F.util.animationFrame();
                const transitionDone = new Promise(resolve => $curBack.on('transitionend', resolve));
                $curBack.css('opacity', '0');
                await F.util.animationFrame();
                $newBack.css('opacity', '1');
                await transitionDone;
                URL.revokeObjectURL($curBack[0].bgUrl);
                $curBack.remove();
                await relay.util.sleep(30);
            }
        }
    });
})();
