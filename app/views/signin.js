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
            'click .f-validate .back.button': 'onValidateBackClick',
            'click .f-new-username.button': 'onEnterNewUsernameClick',
            'click .f-select-username .ui.list .item': 'onKnownUserClick'
        },

        initialize: function() {
            relay.hub.setAtlasUrl(F.env.ATLAS_URL);
        },

        populateKnownUsers: async function() {
            const $list = this.$('.f-select-username .ui.list');
            this.knownUsers = this.getKnownUsers();
            const items = await Promise.all(this.knownUsers.map(async x =>
                `<div data-id="${x.id}" class="item">` +
                    `<img class="ui avatar image" src="${await x.getAvatarURL()}"/>` +
                     `<div class="content">` +
                        `<div class="header">${x.getName()}</div>` +
                        `<small class="description">Last login: 2 weeks ago</small>` +
                     `</div>` +
                `</div>`));
            $list.html(items.join(''));
        },

        getKnownUsers: function() {
            const data = JSON.parse(localStorage.getItem('knownUsers') || '[]');
            return data.map(x => new F.Contact(x));
        },

        saveKnownUsers: function(users) {
            localStorage.setItem('knownUsers', JSON.stringify(users.map(x => x.attributes)));
        },

        rememberKnownUser: function(contact) {
            const users = this.getKnownUsers();
            users.push(contact);
            this.saveKnownUsers(users);
        },

        forgetKnownUser: function(contact) {
            const users = this.getKnownUsers();
            this.saveKnownUsers(users.filter(x => x.id !== contact.id));
        },

        render: async function() {
            this.rotateBackdrop();  // bg only
            await this.populateKnownUsers();
            await F.View.prototype.render.apply(this, arguments);
            this.bindUsernameForm();
            this.bindValidateForm();
            return this;
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
                        $submit.addClass('loading');
                        $error.empty().removeClass('visible');
                        try {
                            await this.requestAuthCode(user, org);
                        } catch(e) {
                            if (e.contentType === 'json') {
                                if (e.content.non_field_errors) {
                                    const errors = e.content.non_field_errors.join('<br/>');
                                    $error.html(errors);
                                } else {
                                    console.warn("Unhandled JSON error response", e);
                                    $error.html(JSON.stringify(e.respContent));
                                }
                            } else {
                                console.warn("Unhandled error response", e);
                                $error.html(e.respContent);
                            }
                            $error.addClass('visible');
                            return;
                        } finally {
                            $submit.removeClass('loading');
                        }
                        this.currentLogin = {user, org};
                        this.selectPage('.f-validate.page');
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
                    username: {
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
                        $submit.addClass('loading');
                        $error.empty().removeClass('visible');
                        let auth;
                        try {
                            auth = await relay.hub.fetchAtlas('/v1/login/authtoken/', {
                                skipAuth: true,
                                method: 'POST',
                                json: {authtoken}
                            });
                        } catch(e) {
                            if (e.contentType === 'json') {
                                if (e.content.non_field_errors) {
                                    const errors = e.content.non_field_errors.join('<br/>');
                                    $error.html(errors);
                                } else {
                                    console.warn("Unhandled JSON error response", e);
                                    $error.html(JSON.stringify(e.respContent));
                                }
                            } else {
                                console.warn("Unhandled error response", e);
                                $error.html(e.respContent);
                            }
                            $error.addClass('visible');
                            return;
                        } finally {
                            $submit.removeClass('loading');
                        }
                        this.rememberKnownUser(new F.Contact(auth.user));
                        this.saveAuthToken(auth);
                        location.assign(F.urls.main);
                    })();
                    return false; // prevent page reload.
                }
            });
        },

        onValidateBackClick: function() {
            this.selectPage('.f-manual-username');
        },

        onEnterNewUsernameClick: function() {
            this.selectPage('.f-manual-username');
        },

        onKnownUserClick: async function(ev) {
            const id = ev.currentTarget.dataset.id;
            const user = this.knownUsers.filter(x => x.id === id)[0];
            // XXX loading...
            try {
                await this.requestAuthCode(user.get('tag').slug, user.get('org').slug);
            } catch(e) {
                // XXX TBD
                throw e;
            } finally {
                // XXX end loading...
            }
            this.currentLogin = {
                user: user.get('tag').slug,
                org: user.get('org').slug
            };
            this.selectPage('.f-validate.page');
        },

        saveAuthToken: function(auth) {
            // This looks crazy because it is, for compat with the admin ui, save a django rest framework
            // style object in localstorage...
            localStorage.setItem('DRF:STORAGE_USER_CONFIG', JSON.stringify({
                API: {
                    TOKEN: auth.token,
                    URLS: {
                        BASE: F.env.ATLAS_URL,
                        WS_BASE: F.env.ATLAS_URL.replace(/^http/, 'ws')
                    }
                }
            }));
        },

        selectPage: async function(selector) {
            const $page = this.$(selector);
            $page.addClass('active').siblings().removeClass('active');
            await F.util.waitTillNextAnimationFrame();
            console.log($page.find('input').first());//.focus();
            $page.find('input').first().focus();
        },

        requestAuthCode: async function(user, org) {
            const url = `/v1/login/send/${org}/${user}/`;
            await relay.hub.fetchAtlas(url, {skipAuth: true});
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
                await F.util.waitTillNextAnimationFrame();
                const transitionDone = new Promise(resolve => $curBack.on('transitionend', resolve));
                $curBack.css('opacity', '0');
                await F.util.waitTillNextAnimationFrame();
                $newBack.css('opacity', '1');
                await transitionDone;
                URL.revokeObjectURL($curBack[0].bgUrl);
                $curBack.remove();
                await relay.util.sleep(30);
            }
        }
    });
})();
