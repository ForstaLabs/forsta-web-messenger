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
            'click .f-select-username .ui.list .item .close': 'onKnownUserCloseClick'
        },

        initialize: function() {
            relay.hub.setAtlasUrl(F.env.ATLAS_URL);
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
            this.bindValidateForm();
            this.bindPasswordForm();
            return this;
        },

        parseFetchError: function(e) {
            if (e.contentType === 'json') {
                if (e.content.non_field_errors) {
                    return e.content.non_field_errors.join('<br/>');
                } else {
                    console.warn("Unhandled JSON error response", e);
                    return JSON.stringify(e.respContent);
                }
            } else {
                console.error("Unhandled error response", e);
                return e;
            }
        },

        bindUsernameForm: function() {
            const $form = this.$('.f-manual-username .ui.form');
            const $submit = $form.find('.submit');
            const $error = $form.find('.error.message');
            $form.form({
                on: 'change',
                fields: {
                    username: {
                        identifier: 'forsta-username',
                        rules: [{
                            type: 'empty',
                        }, {
                            type: 'regExp',
                            value: /^@?[a-z]+[a-z0-9._]*(:[a-z]+[a-z0-9._]*)?$/i,
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
                        $error.empty().removeClass('visible');
                        let smsAuth;
                        try {
                            smsAuth = await this.authRequest(user, org);
                        } catch(e) {
                            $error.html(this.parseFetchError(e)).addClass('visible');
                            return;
                        } finally {
                            $submit.removeClass('loading disabled');
                        }
                        this.currentLogin = {user, org};
                        this.selectPage(smsAuth ? '.f-validate.page' : '.f-password.page');
                    })();
                    return false; // prevent page reload.
                }
            });
        },

        bindValidateForm: function() {
            const $form = this.$('.f-validate .ui.form');
            const $submit = $form.find('.submit');
            const $error = $form.find('.error.message');
            $form.form({
                on: 'change',
                fields: {
                    auth_code: {
                        identifier: 'forsta-auth-code',
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
                        const code = $form.form('get value', 'forsta-auth-code');
                        const authtoken = [this.currentLogin.org, this.currentLogin.user, code].join(':');
                        $submit.addClass('loading disabled');
                        $error.empty().removeClass('visible');
                        let auth;
                        try {
                            auth = await relay.hub.fetchAtlas('/v1/login/', {
                                skipAuth: true,
                                method: 'POST',
                                json: {authtoken}
                            });
                        } catch(e) {
                            $error.html(this.parseFetchError(e)).addClass('visible');
                            $submit.removeClass('loading disabled');
                            return;
                        }
                        this.rememberKnownUser(new F.Contact(auth.user));
                        F.atlas.saveAuth(auth.token);
                        location.assign(F.urls.main);
                    })();
                    return false; // prevent page reload.
                }
            });
        },

        bindPasswordForm: function() {
            const $form = this.$('.f-password .ui.form');
            const $submit = $form.find('.submit');
            const $error = $form.find('.error.message');
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
                        $submit.addClass('loading disabled');
                        $error.empty().removeClass('visible');
                        const password = $form.form('get value', 'forsta-password');
                        const fq_tag = `@${this.currentLogin.user}:${this.currentLogin.org}`;
                        let auth;
                        try {
                            auth = await relay.hub.fetchAtlas('/v1/login/', {
                                skipAuth: true,
                                method: 'POST',
                                json: {fq_tag, password}
                            });
                        } catch(e) {
                            $error.html(this.parseFetchError(e)).addClass('visible');
                            $submit.removeClass('loading disabled');
                            return;
                        }
                        this.rememberKnownUser(new F.Contact(auth.user));
                        F.atlas.saveAuth(auth.token);
                        location.assign(F.urls.main);
                    })();
                    return false; // prevent page reload.
                }
            });
        },

        onBackClick: function() {
            this.selectPage(this.$lastActive);
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
            let smsAuth;
            try {
                smsAuth = await this.authRequest(user.get('tag').slug, user.get('org').slug);
            } catch(e) {
                $error.html(this.parseFetchError(e)).addClass('visible');
                return;
            } finally {
                $loading.dimmer('hide');
            }
            this.currentLogin = {
                user: user.get('tag').slug,
                org: user.get('org').slug
            };
            this.selectPage(smsAuth ? '.f-validate.page' : '.f-password.page');
        },

        onKnownUserCloseClick: function(ev) {
            const id = $(ev.currentTarget).closest('.item').data('id');
            this.forgetKnownUser(id);
            this.render();
            return false;
        },

        selectPage: async function(selector) {
            this.$lastActive = this.$('.page.active');
            const $page = this.$(selector);
            $page.addClass('active').siblings('.page').removeClass('active');
            await F.util.animationFrame();
            $page.find('input').first().focus();
        },

        authRequest: async function(user, org) {
            const url = `/v1/login/send/${org}/${user}/`;
            try {
                await relay.hub.fetchAtlas(url, {skipAuth: true});
                return true;  // SMS Auth
            } catch(e) {
                if (e.code === 409 &&
                    e.content.non_field_errors[0] === 'password auth required') {
                    return false;  // Password Auth
                } else {
                    throw e;
                }
            }
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
