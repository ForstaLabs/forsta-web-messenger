// vim: ts=4:sw=4:expandtab
/* global relay moment Handlebars */

(function () {
    'use strict';

    self.F = self.F || {};
    const DELIM = '➕➕➕';  // Use special unicode delim to avoid conflicts.

    function cleanPhoneNumber(value) {
        const digits = value.replace(/[^0-9]/g, '');
        if (digits.length < 10) {
            return;
        } else if (digits.length === 10) {
            return '+1' + digits;
        } else if (digits.length === 11) {
            return '+' + digits;
        } else {
            return value;  // International?
        }
    }

    if (!$.fn.form.settings.rules.phone) {
        $.fn.form.settings.rules.phone = value => !value || !!cleanPhoneNumber(value);
    }

    F.NewThreadView = F.View.extend({

        slugItemIdenter: 0,

        initialize: function() {
            this.tags = F.foundation.getTags();
            this.contacts = F.foundation.getContacts();
            /* Get notified of any relevant user/tag changes but debounce events to avoid
             * needless aggregation and layouts. */
            const debouncedOnChange = _.debounce(this.onChange.bind(this), 400);
            this.listenTo(this.tags, 'add remove reset change', debouncedOnChange);
            this.listenTo(this.contacts, 'add remove reset change', debouncedOnChange);
            this.loading = F.util.idle().then(this.loadData.bind(this));
        },

        render: async function() {
            this.$panel = $('#f-new-thread-panel');
            this.$panel.on('click', '.f-import-contacts', this.onImportContacts.bind(this));
            this.$fab = $('.f-start-new.f-opened');
            this.$fab.on('click', '.f-complete.icon:not(.off)', this.onCompleteClick.bind(this));
            this.$fab.on('click', '.f-cancel.icon', this.togglePanel.bind(this));
            this.$fab.on('click', '.f-support.icon', this.onSupportClick.bind(this));
            this.$fab.on('click', '.f-invite.icon', this.onInviteClick.bind(this));
            this.$fabClosed = $('.f-start-new.f-closed');
            this.$fabClosed.on('click', 'i:first-child,i:nth-child(2)', this.togglePanel.bind(this));
            this.$dropdown = this.$panel.find('.f-start-dropdown');
            this.$panel.find('.f-header-menu .ui.dropdown').dropdown();
            this.$menu = this.$dropdown.find('.menu .menu');
            this.$searchInput = this.$panel.find('input[name="f-start-search"]');
            this.$searchInput.on('input', this.onSearchInput.bind(this));
            // Must use event capture here...
            this.$searchInput[0].addEventListener('keydown', this.onKeyDown.bind(this), true);
            this.dropdown = this.$dropdown.dropdown.bind(this.$dropdown);
            this.dropdown({
                fullTextSearch: 'exact',
                onChange: this.onSelectionChange.bind(this),
                onHide: () => false, // Always active.
                onLabelCreate: this.onLabelCreate,
                delimiter: DELIM
            });
            this.$announcement = this.$panel.find('.ui.checkbox');
            this.$announcement.checkbox();
            if (F.util.isCoarsePointer()) {
                this.$fab.addClass('open');
            }
            if (this.loading) {
                await this.loading;
                this.loading = undefined;
            }
            return this;
        },

        onLabelCreate: function(value, html) {
            const $el = this; // The jquery element to fillout is provided via scope.
            $el.find('.description').remove();
            return $el;
        },

        togglePanel: function() {
            const collapsed = !this.$panel.height();
            if (collapsed) {
                this.showPanel();
            } else {
                this.hidePanel();
            }
        },

        showPanel: async function() {
            $('nav > .ui.segment').scrollTop(0);
            this.$fabClosed.hide();
            this.$fab.show();
            this.dropdown('show');
            this.resetState();
            this.$panel.addClass('expanded');
            this.$panel.css({
                transition: 'max-height 400ms ease',
                maxHeight: '100vh'
            });
            if (this.needLoad && !this.loading) {
                this.needLoad = false;
                this.loading = this.loadData();
            }
            if (this.loading) {
                this.$panel.find('.ui.dimmer').dimmer('show');
                await this.loading;
                this.$panel.find('.ui.dimmer').dimmer('hide');
                this.dropdown('show');
                this.resetState();
            }
            if (!F.util.isCoarsePointer()) {
                this.dropdown('focusSearch');
            }
        },

        hidePanel: function() {
            /* Smoother animation by reseting max-height to current value first. */
            this.$fab.hide();
            this.$fabClosed.show();
            this.$panel.css({
                transition: '',
                maxHeight: this.$panel.height() + 'px'
            });
            requestAnimationFrame(() => {
                this.$panel.removeClass('expanded');
                this.$panel.css({
                    transition: 'max-height 300ms ease',
                    maxHeight: '0'
                });
                this.$panel.css('max-height', '');
                this.resetState();
                this.adjustFAB();
            });
        },

        resetState: function() {
            this.$panel.find('.ui.dropdown').dropdown('restore defaults');
            this.resetSearch();
        },

        resetSearch: function() {
            this.$searchInput.val('');
            this.dropdown('filter', '');
            this.$dropdown.find('.scrolling.menu').scrollTop(0);
        },

        onKeyDown: async function(ev) {
            if (ev.keyCode === /*enter*/ 13) {
                if (ev.ctrlKey) {
                    ev.stopPropagation();
                    ev.preventDefault();
                    await this.onCompleteClick();
                } else if (this.dropdown('has allResultsFiltered')) {
                    const expression = relay.hub.sanitizeTags(this.dropdown('get query'));
                    ev.preventDefault();
                    ev.stopPropagation();
                    const id = `slugitem-${this.slugItemIdenter++}`;
                    const $item = $(`<div class="item" data-value="${expression}">` +
                                        `<i id="${id}" class="f-status icon loading notched circle"></i>` +
                                        `<div class="slug">${expression}</div>` +
                                    `</div>`);
                    this.dropdown('set selected', expression, $item);
                    this.resetSearch();
                    await this.verifyExpression(expression, id);
                }
            }
        },

        onChange: async function() {
            if (!this.$panel.height()) {
                this.needLoad = true;
            } else {
                this.needLoad = false;
                this.loading = await this.loadData();
            }
        },

        verifyExpression: async function(expression, id) {
            const about = await F.atlas.resolveTagsFromCache(expression);
            let title;
            let icon;
            if (!about.warnings.length) {
                title = 'Verified';
                icon = 'green checkmark';
            } else if (about.universal) {
                title = 'Some problems detected';
                icon = 'yellow warning sign';
            } else {
                title = 'Invalid expression';
                icon = 'red warning circle';
            }
            const $icon = this.$panel.find(`#${id}`);
            $icon.attr('class', `icon ${icon}`).attr('title', title);
        },

        loadData: async function() {
            return await F.queueAsync(this, this._loadData.bind(this));
        },

        _loadData: async function() {
            const updates = [];
            if (this.contacts.length) {
                updates.push('<div class="f-contacts-header header">');
                updates.push('  <i class="icon users"></i> Contacts');
                updates.push('  <a class="f-import-contacts">Import Contacts</a>');
                updates.push('</div>');
                for (const user of this.contacts.filter(x => !x.get('pending'))) {
                    const name = user.id === F.currentUser.id ? '<i>[You]</i>' : user.getName();
                    const tag = user.getTagSlug();
                    updates.push(`<div class="item" data-value="${tag}">` +
                                     `<div class="f-avatar f-avatar-image image">` +
                                         `<img src="${await user.getAvatarURL()}"/>` +
                                     `</div>` +
                                     `<div class="slug">${name}</div>` +
                                     `<div title="${tag}" class="description">${tag}</div>` +
                                 '</div>');
                }
            }
            if (this.tags.length) {
                updates.push('<div class="divider"></div>');
                updates.push('<div class="header"><i class="icon tags"></i> Tags</div>');
                const ourSlug = F.currentUser.getTagSlug().substr(1);
                const groupTags = this.tags.filter(x => !x.get('user') && x.get('slug') !== ourSlug);
                const tagsMeta = await F.atlas.resolveTagsBatchFromCache(groupTags.map(
                    x => '@' + x.get('slug')));
                const tagHtml = groupTags.map((tag, i) => {
                    const slug = tag.get('slug');
                    const memberCount = tagsMeta[i].userids.length;
                    if (!memberCount) {
                        return '';
                    }
                    return `<div class="item" data-value="@${slug}">` +
                               `<div class="slug"><b>@</b>${slug}</div>` +
                               `<div class="description">${memberCount} members</div>` +
                           '</div>';
                });
                updates.push(tagHtml.join(''));
            }
            this.$menu.html(updates.join(''));
        },

        getExpression: function() {
            const selected = [];
            for (const x of this.dropdown('get value').split(DELIM)) {
                const clean = x.trim();
                if (clean) {
                    selected.push(clean);
                }
            }
            const input = relay.hub.sanitizeTags(this.dropdown('get query'));
            if (selected.length && input) {
                return `${selected.join(' ')} ${input}`;
            } else {
                return selected.length ? selected.join(' ') : input;
            }
        },

        onSearchInput: function() {
            this.adjustFAB();
        },

        onSelectionChange: function() {
            this.resetSearch();
            this.adjustFAB();
            if (!F.util.isCoarsePointer()) {
                this.dropdown('focusSearch');
            }
        },

        adjustFAB: function() {
            const dis = 'grey off ellipsis horizontal';
            const en = 'green checkmark';
            if (this.getExpression()) {
                this.$fab.find('.f-complete.icon').removeClass(dis).addClass(en);
                if (this._fabEnState === false) {
                    this.$fab.transition('bounce');
                }
                this._fabEnState= true;
            } else {
                this.$fab.find('.f-complete.icon').removeClass(en).addClass(dis);
                this._fabEnState= false;
            }
        },

        onImportContacts: async function(ev) {
            ev.preventDefault();
            await (new F.ImportContactsView()).show();
        },

        onCompleteClick: async function() {
            await this.doComplete(this.getExpression());
        },

        onSupportClick: async function() {
            await this.doComplete('@support:forsta');
        },

        doComplete: async function(expression) {
            const $icon = this.$fab.find('.f-complete.icon');
            const iconClass = $icon.data('icon');
            $icon.removeClass(iconClass).addClass('loading notched circle');
            const completed = (await this.startThread(expression) !== false);
            $icon.removeClass('loading notched circle').addClass(iconClass);
            if (completed) {
                this.hidePanel();
            }
        },


        onInviteClick: async function() {
            this.hidePanel();
            const messageTpl = Handlebars.compile(
                `Hi{{#if name}} {{name}}{{/if}},\n\nI'm using Forsta for secure messaging.  ` +
                `Please accept this invitation to chat to with me!`);
            const modal = new F.ModalView({
                header: 'Create Invite',
                icon: 'world',
                size: 'tiny',
                content: [
                    `<p>This form lets you send an SMS or email invitation to anyone not `,
                    `currently using Forsta.  You can even prepare messages for them that will `,
                    `be automatically sent to them after they sign-up.`,
                    `<div class="ui form">`,
                        `<div class="ui field">`,
                            `<label>Name</label>`,
                            `<input type="text" name="name" placeholder="Full Name"/>`,
                        `</div>`,
                        `<div class="fields two">`,
                            `<div class="ui field">`,
                                `<label>Phone</label>`,
                                `<input type="text" name="phone" placeholder="SMS Number"/>`,
                            `</div>`,
                            `<div class="ui field">`,
                                `<label>Email</label>`,
                                `<input type="text" name="email" placeholder="Email Address"/>`,
                            `</div>`,
                        `</div>`,
                        `<div class="ui field">`,
                            `<label>Invitation Message</label>`,
                            `<textarea name="message" maxlength="256" rows="4"></textarea>`,
                        `</div>`,
                    `</div>`,
                ].join(''),
                actions: [{
                    class: 'f-dismiss',
                    label: 'Dismiss'
                }, {
                    class: 'f-submit primary',
                    label: 'Invite'
                }]
            });
            await modal.show();
            const $form = modal.$('.ui.form');
            $form.form({
                on: 'blur',
                inline: true,  // error messages
                fields: {
                    phone: {
                        identifier: 'phone',
                        rules: [{
                            type: 'phone',
                            prompt: 'Invalid phone number'
                        }]
                    }
                }
            });
            $form.form('set value', 'message', messageTpl());
            modal.$el.on('input', 'input[name="name"]', ev =>
                $form.form('set value', 'message', messageTpl({name: ev.currentTarget.value})));
            $form.on('submit', async ev => {
                if (!$form.form('validate form')) {
                    return;
                }
                const phone = cleanPhoneNumber($form.form('get value', 'phone')) || undefined;
                if (phone === F.currentUser.attributes.phone) {
                    $form.form('add prompt', 'phone', 'Do not use your number');
                    return;
                }
                const email = $form.form('get value', 'email') || undefined;
                modal.$('.ui.dimmer').dimmer('show');
                const existing = await F.atlas.searchContacts({phone, email},
                                                              {disjunction: true});
                if (existing.length) {
                    const suggestView = new F.PhoneSuggestionView({members: existing});
                    await suggestView.show();
                } else {
                    try {
                        await this.startInvite(phone, $form.form('get value', 'name'),
                                               email, $form.form('get value', 'message'));
                    } finally {
                        modal.hide();
                    }
                }
            });
            modal.$el.on('click', '.f-submit', ev => $form.form('submit'));
            modal.$el.on('click', '.f-dismiss', ev => modal.hide());
        },

        startInvite: async function(phone, name, email, message) {
            let first_name;
            let last_name;
            if (name) {
                const names = name.split(/\s+/);
                if (names[0]) {
                    first_name = names[0];
                }
                if (names[1]) {
                    last_name = names.slice(1).join(' ');
                }
            }
            let resp;
            try {
                resp = await relay.hub.fetchAtlas('/v1/invitation/', {
                    method: 'POST',
                    json: {
                        phone,
                        first_name,
                        last_name,
                        email,
                        message
                    }
                });
            } catch(e) {
                F.util.promptModal({
                    icon: 'warning sign red',
                    header: 'Invite Error',
                    content: `Error trying to invite user: ${e}`
                });
                return;
            }
            const pendingMember = new F.Contact({
                id: resp.invited_user_id,
                first_name: first_name || 'Invited User',
                last_name: last_name || `(${email || phone})`,
                created: Date.now(),
                modified: Date.now(),
                pending: true,
                phone,
                tag: {
                    id: null,
                    slug: 'pending.user'
                },
                org: {
                    id: null,
                    slug: phone.replace(/[^0-9]/, '')
                }
            });
            await pendingMember.save();
            F.foundation.getContacts().add(pendingMember);
            const attrs = {
                type: 'conversation',
                pendingMembers: [pendingMember.id]
            };
            const threads = F.foundation.allThreads;
            const thread = await threads.make(F.currentUser.getTagSlug(), attrs);
            thread.addNotice({
                title: 'Invitation Sent!',
                detail: 'Invited recipients will receive any messages ' +
                        'you send after they have completed sign-up.',
                className: 'success',
                icon: 'world'
            });
            await F.mainView.openThread(thread);
        },

        startThread: async function(expression) {
            if (!expression) {
                return;
            }
            const is_announcement = this.$panel.find('input[name="threadType"]').val() === 'announcement';
            const attrs = {
                type: is_announcement ? 'announcement' : 'conversation'
            };
            if (is_announcement) {
                attrs.sender = F.currentUser.id;
            }
            const threads = F.foundation.allThreads;
            let dist;
            try {
                dist = await threads.normalizeDistribution(expression);
            } catch(e) {
                if (e instanceof ReferenceError) {
                    F.util.promptModal({
                        icon: 'warning sign red',
                        header: 'Failed to find or create thread',
                        content: e.toString()
                    });
                    return false;
                } else {
                    throw e;
                }
            }
            // XXX Announcements are one time use presently, Always make new until they support this.
            const recentThread = is_announcement ? null : threads.findByDistribution(dist.universal, attrs.type)[0];
            if (recentThread) {
                const reuse = await F.util.confirmModal({
                    size: 'tiny',
                    header: `Use existing ${attrs.type}?`,
                    content: `A similar ${attrs.type} was found...` +
                             `<form style="padding: 1em;" class="ui form small">` +
                                `<div class="field"><label>Title</label>` +
                                    `${recentThread.getNormalizedTitle()}</div>` +
                                `<div class="field"><label>Distribution</label>` +
                                    `${dist.pretty}</div>` +
                                `<div class="field inline"><label>Last Activity:</label> ` +
                                    `${moment(recentThread.timestamp).fromNow()}</div>` +
                                `<div class="field inline"><label>Message Count:</label> ` +
                                    `${await recentThread.messages.totalCount()}</div>` +
                             `</form>` +
                             `<div class="ui divider"></div>` +
                             `<b>Would you like to reuse this ${attrs.type} or start a new ` +
                                `one?</b>`,
                    confirmLabel: 'Use Existing',
                    dismissLabel: 'Start New'
                });
                if (reuse === undefined) {
                    return false; // They did not choose an action.
                } else if (reuse) {
                    // Bump the timestamp given the interest level change.
                    await recentThread.save({timestamp: Date.now()});
                    await F.mainView.openThread(recentThread);
                    return;
                }
            }
            await F.mainView.openThread(await threads.make(expression, attrs));
        }
    });
})();
