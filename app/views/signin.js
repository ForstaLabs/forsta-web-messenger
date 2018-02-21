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
            'click .f-new-username.button': 'onEnterNewUsernameClick'
        },

        populateKnownUsers: async function() {
            const $list = this.$('.f-select-username .ui.list');
            const knownUsers = [{
                avatar: await F.util.textAvatarURL('JM'),
                name: 'Justin Mayfield'
            }, {
                avatar: await F.util.textAvatarURL('BS'),
                name: 'Bob Smith'
            }];
            $list.html(knownUsers.map(x => `<div class="item">` +
                                             `<img class="ui avatar image" src="${x.avatar}"/>` +
                                             `<div class="content">` +
                                               `<div class="header">${x.name}</div>` +
                                               `<small class="description">Last login: 2 weeks ago</small>` +
                                             `</div>` +
                                           `</div>`).join(''));
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
                        const [user, org] = username.replace(/^@/, '').split(':');
                        const url = `/v1/login/send/${org || 'forsta'}/${user}/`;
                        $submit.addClass('loading');
                        $error.empty().removeClass('visible');
                        try {
                            const resp = await relay.hub.fetchAtlas(url, {skipAuth: true});
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
                        this.$('.f-validate.page').addClass('active').siblings().removeClass('active');
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
                onSuccess: async () => {
                    const username = $form.form('get value', 'forsta-username').toLowerCase();
                    const [user, org] = username.replace(/^@/, '').split(':');
                    const url = `/v1/login/send/${org || 'forsta'}/${user}/`;
                    $submit.addClass('loading');
                    $error.empty().removeClass('visible');
                    try {
                        const resp = await relay.hub.fetchAtlas(url, {skipAuth: true});
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
                    this.selectPage('.f-validate.page');
                }
            });
        },

        onValidateBackClick: function() {
            this.selectPage('.f-manual-username');
        },

        onEnterNewUsernameClick: function() {
            this.selectPage('.f-manual-username');
        },

        selectPage: function(selector) {
            this.$(selector).addClass('active').siblings().removeClass('active');
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
