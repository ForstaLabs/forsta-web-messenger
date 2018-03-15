// vim: ts=4:sw=4:expandtab
/* global relay gapi */

(function () {
    'use strict';

    self.F = self.F || {};

    const scope = 'https://www.googleapis.com/auth/contacts.readonly';

    let _googleApiInit;

    async function initGoogleApi() {
        await new Promise((resolve, reject) => {
            $.ajax({
                url: 'https://apis.google.com/js/api.js',
                dataType: 'script',
                cache: true
            }).then(resolve).catch(reject);
        });
        await new Promise((resolve, reject) => {
            gapi.load('client:auth2', {
                callback: resolve,
                onerror: reject,
                ontimeout: reject,
                timeout: 30000,
            });
        });
        await gapi.client.init({
            clientId: F.env.DISCOVER_GOOGLE_AUTH_CLIENT_ID,
            scope,
            discoveryDocs: ['https://people.googleapis.com/$discovery/rest']
        });
    }

    F.ImportContactsView = F.ModalView.extend({
        template: 'views/import-contacts.html',

        events: {
            'click .actions .button.f-dismiss': 'onDismissClick',
            'click .actions .button.f-authorize': 'onAuthorizeClick',
            'click .actions .button.f-save': 'onSaveClick',
            'click .header .icon.link.checkmark': 'onToggleSelectionClick'
        },

        initialize: function() {
            F.ModalView.prototype.initialize.call(this, {
                size: 'tiny',
                options: {
                    closable: false
                }
            });
        },

        selectStep: function(step) {
            this.$('[data-step]').hide();
            return this.$(`[data-step="${step}"]`).show();
        },

        render: async function() {
            await F.ModalView.prototype.render.apply(this, arguments);
            this.$('.actions .button.f-save').hide();
            this.selectStep(1);
            if (!_googleApiInit) {
                _googleApiInit = initGoogleApi();
            }
            await _googleApiInit;
            this.$('.actions .button.f-authorize').removeClass('disabled');
            return this;
        },

        onDismissClick: function() {
            this.hide();
            this.remove();
        },

        onAuthorizeClick: async function() {
            let $step = this.selectStep(2);
            this.$('.actions .button.f-authorize').hide();
            this.$('.actions .button.f-dismiss').addClass('disabled');
            this.gAuth = gapi.auth2.getAuthInstance();
            $step.find('.header .content').html("Awaiting approval...");
            const loadingIcon = 'loading circle notched';
            $step.find('.header .icon').addClass(loadingIcon);
            $step.find('.progress').hide();
            try {
                await this.gAuth.signIn();
            } catch(e) {
                console.error('Authorization error:', e);
                $step.find('.header .icon').removeClass(loadingIcon).addClass('red warning sign');
                $step.find('.header .content').html(e.error || 'Authorization error');
                this.$('.actions .button.f-dismiss').removeClass('disabled');
                return;
            }
            $step.find('.header .content').html("Scanning Google contacts...");
            $step.find('.header .icon').removeClass(loadingIcon).addClass('cloud download');
            $step.find('.progress').show();
            try {
                this.contacts = await this.importContacts();
            } catch(e) {
                console.error('Import contacts error:', e);
                F.util.promptModal({
                    icon: 'red warning sign',
                    header: 'Import contacts error',
                    content: e
                });
                throw e;
            } finally {
                this.gAuth.disconnect();
                await this.gAuth.signOut();
            }
            this.$('.actions .button.f-dismiss').removeClass('disabled');
            if (this.contacts.length) {
                this.$('.actions .button.f-dismiss').removeClass('disabled');
                $step = this.selectStep(3);
                this.contacts.sort((a, b) => {
                    const left = a.getName();
                    const right = b.getName();
                    return left === right ? 0 : left < right ? -1 : 1;
                });
                for (const x of this.contacts) {
                    this.$('.f-matches').append([
                        '<div class="member-row">',
                            '<div class="member-avatar">',
                                `<div class="f-avatar f-avatar-image"><img src="${await x.getAvatarURL()}"/></div>`,
                            '</div>',
                            '<div class="member-info">',
                                `<div class="name">${x.getName()}</div>`,
                                `<div class="slug">${x.getTagSlug()}</div>`,
                            '</div>',
                            '<div class="member-extra">',
                                `<div class="ui checkbox checked" data-id="${x.id}">`,
                                    `<input type="checkbox" checked/>`,
                                    '<label/>',
                                '</div>',
                            '</div>',
                        '</div>',
                    ].join(''));
                    this.$('.ui.checkbox').checkbox();
                }
                this.$('.actions .button.f-save').show();
            }
        },

        onSaveClick: async function() {
            const checked = this.$('.member-list .checkbox.checked');
            const ids = new Set(checked.map((_, x) => x.dataset.id));
            const additions = this.contacts.filter(x => ids.has(x.id));
            await Promise.all(additions.map(x => x.save()));
            F.foundation.getContacts().add(additions);
            this.hide();
            this.remove();
        },

        onToggleSelectionClick: function() {
            this.$('.ui.checkbox').checkbox(this.checkAll ? 'check' : 'uncheck');
            this.checkAll = !this.checkAll;
        },

        importContacts: async function() {
            let pageToken;
            let backoff = 1;
            let count = 0;
            let pageSize = 10;
            const matches = [];
            const ids = new Set();
            do {
                let resp;
                try {
                    resp = await gapi.client.people.people.connections.list({
                        resourceName: 'people/me',
                        personFields: 'emailAddresses,phoneNumbers',
                        pageSize,
                        pageToken
                    });
                } catch(e) {
                    if (e.status === 429) {
                        console.warn('Throttling contact request:', backoff);
                        await relay.util.sleep((backoff *= 2));
                        continue;
                    } else {
                        throw e;
                    }
                }
                pageToken = resp.result.nextPageToken;
                pageSize = Math.round(Math.min(pageSize *= 1.25, 250));
                const connections = resp.result.connections || [];
                count += connections.length;
                for (const x of await this.findIntersection(connections)) {
                    if (!ids.has(x.id)) {
                        ids.add(x.id);
                        matches.push(x);
                    }
                }
                this.$('.ui.progress').progress({
                    value: count,
                    total: resp.result.totalItems,
                    text: {
                        active: `{value} of {total} scanned (${matches.length} new matches)`,
                        success: `All Done! (${matches.length} new matches found)`
                    }
                });
                if (!pageToken) {
                    this.$('.ui.progress').progress('complete');
                }
            } while(pageToken);
            return matches;
        },

        findIntersection: async function(connections) {
            const phones = new Set();
            const emails = new Set();
            const prefixSize = F.currentUser.get('phone').length - 7;
            const defaultPrefix = F.currentUser.get('phone').substr(0, prefixSize);
            for (const c of connections) {
                if (c.phoneNumbers) {
                    for (const x of c.phoneNumbers) {
                        const phone = x.value.replace(/[^0-9+]/g, '');
                        if (phone.length < 7) {
                            console.warn("Dropping invalid phone number:", x.value);
                            continue;
                        } else if (phone.length === 7) {
                            phones.add(defaultPrefix + phone);
                        } else if (phone.length === 10) {
                            if (!phone.match(/\+/)) {
                                phones.add('+1' + phone);
                            } else {
                                console.warn("Suspect phone number detected:", x.value);
                                phones.add(phone);
                            }
                        } else if (phone.length === 11) {
                            if (!phone.match(/\+/)) {
                                phones.add('+' + phone);
                            } else {
                                console.warn("Suspect phone number detected:", x.value);
                                phones.add(phone);
                            }
                        } else {
                            if (!phone.match(/\+/)) {
                                console.warn("Suspect phone number detected:", x.value);
                            }
                            phones.add(phone);
                        }
                    }
                }
                if (c.emailAddresses) {
                    for (const x of c.emailAddresses) {
                        const email = x.value.trim();
                        if (email) {
                            emails.add(email);
                        }
                    }
                }
            }
            if (!phones.size && !emails.size) {
                return [];
            }
            const results = await F.atlas.searchContacts({
                phone_in: phones.size ? Array.from(phones) : undefined,
                email_in: emails.size ? Array.from(emails) : undefined
            }, {disjunction: true});
            const contactCollection = F.foundation.getContacts();
            return results.filter(x => !contactCollection.get(x.id));
        }
    });
})();
