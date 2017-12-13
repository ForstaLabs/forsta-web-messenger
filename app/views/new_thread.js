// vim: ts=4:sw=4:expandtab
/* global relay moment */

(function () {
    'use strict';

    self.F = self.F || {};
    const DELIM = '➕➕➕';  // Use special unicode delim to avoid conflicts.

    F.NewThreadView = F.View.extend({

        slugItemIdenter: 0,

        initialize: function() {
            this.tags = F.foundation.getTags();
            this.users = F.foundation.getUsers();
            /* Get notified of any relevant user/tag changes but debounce events to avoid
             * needless aggregation and layouts. */
            const debouncedOnChange = _.debounce(this.onChange.bind(this), 100);
            this.listenTo(this.tags, 'add remove reset change', debouncedOnChange);
            this.listenTo(this.users, 'add remove reset change', debouncedOnChange);
        },

        render: async function() {
            this.$panel = $('#f-new-thread-panel');
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
            this.$searchInput = this.$panel.find('input[name="search"]');
            this.$searchInput.on('input', this.onSearchInput.bind(this));
            this.$panel.find('.ui.menu > .item[data-tab]').tab();
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
            await this.loadData();
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

        showPanel: function() {
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
            await F.queueAsync(this, this.loadData.bind(this));
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
            const us = F.currentUser.getSlug();
            const updates = [];
            if (this.users.length) {
                updates.push('<div class="header"><i class="icon users"></i> Users</div>');
                for (const user of this.users.filter(x =>
                     x.get('is_active') && x.id !== F.currentUser.id)) {
                    const slug = user.getSlug();
                    updates.push(`<div class="item" data-value="@${slug}">` +
                                     `<img class="f-avatar ui image avatar" src="${(await user.getAvatar()).url}"/>` +
                                     `<div class="slug">${user.getName()}</div>` +
                                     `<div class="description"><b>@</b>${slug}</div>` +
                                 '</div>');
                }
            }
            if (this.tags.length) {
                updates.push('<div class="divider"></div>');
                updates.push('<div class="header"><i class="icon tags"></i> Tags</div>');
                for (const tag of this.tags.filter(x => !x.get('user') && x.get('slug') !== us)) {
                    const slug = tag.get('slug');
                    const members = tag.get('users').length ? `${tag.get('users').length} members` : '<i>empty</i>';
                    updates.push(`<div class="item" data-value="@${slug}">` +
                                     `<div class="slug"><b>@</b>${slug}</div>` +
                                     `<div class="description">${members}</div>` +
                                 '</div>');
                }
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
            if (!F.util.isCoarsePointer() && this.$fab.is('visible')) {
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

        onCompleteClick: async function() {
            await this.doComplete(this.getExpression());
        },

        onSupportClick: async function() {
            await this.doComplete('@support:forsta');
        },

        onInviteClick: async function() {
            this.hidePanel();
            const modal = new F.ModalView({
                header: 'Invite by SMS',
                icon: 'mobile',
                size: 'tiny',
                content: [
                    `<p>You can send an SMS invitation to a user who is not already signed up for `,
                    `Forsta.  Any messages you send to them before they sign up will be waiting `,
                    `for them once they complete the signup process.`,
                    `<div class="ui form">`,
                        `<div class="ui field inline">`,
                            `<label>Phone/SMS</label>`,
                            `<input type="text" placeholder="Phone/SMS"/>`,
                        `</div>`,
                        `<div class="ui error message">`,
                            `Phone number should include <b>area code</b> `,
                            `and country code if applicable.`,
                        `</div>`,
                    `</div>`
                ].join(''),
                footer: 'NOTE: Outgoing messages are stored on your device until the invited user ' +
                        'completes sign-up so that they can be encrypted end-to-end.',
                actions: [{
                    class: 'approve blue',
                    label: 'Invite'
                }],
                options: {
                    onApprove: async () => {
                        const $input = modal.$modal.find('input');
                        let phone = $input.val().replace(/[^0-9]/g, '');
                        if (phone.length < 10) {
                            modal.$modal.find('.ui.form').addClass('error');
                            return false;
                        } else if (phone.length === 10) {
                            phone = '+1' + phone;
                        } else if (phone.length === 11) {
                            phone = '+' + phone;
                        }
                        // if phone exists go to different screen
                        // else start invite
                        const registered = await F.atlas.findUsers({phone});
                        if (registered.length > 0) {
                            this.suggestFromPhone(registered);
                        } else {
                            this.startInvite(phone);
                        }
                    }
                }
            });
            await modal.show();
            modal.$modal.find('input')[0].addEventListener('keydown', ev => {
                if (ev.keyCode === /*enter*/ 13) {
                    modal.$modal.find('.approve.button').click();
                    ev.stopPropagation();
                    ev.preventDefault();
                }
            }, true);
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

        suggestFromPhone: async function(regist) {
            const suggestions = await this.getCards(regist);
            const modal = new F.ModalView({
                icon: 'warning red',
                header: 'Existing Users Found:',
                content: '<div class="member-list"></div>',
                actions: [{
                    class: 'deny black',
                    label: 'Cancel',
                }]
            });
            await modal.render();
            for (let sug of suggestions) {
                modal.$('.member-list').append(sug.$el);
            }
            await modal.show();
        },

        getCards: async function(res) {
            let content = [];
            for (let x of res) {
                const sug = new F.PhoneSuggestionView(x);
                await sug.render();
                content.push(sug);
            }
            return content;
        },

        startInvite: async function(phone) {
            let resp;
            try {
                resp = await F.atlas.fetch('/v1/invitation/', {
                    method: 'POST',
                    json: {phone}
                });
            } catch(e) {
                F.util.promptModal({
                    icon: 'warning sign red',
                    header: 'Invite Error',
                    content: `Error trying to invite user: ${e}`
                });
                return;
            }
            const attrs = {
                type: 'conversation',
                pendingMembers: [resp.invited_user_id]
            };
            const threads = F.foundation.allThreads;
            await F.mainView.openThread(await threads.make('@' + F.currentUser.getSlug(), attrs));
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
            const recentThread = threads.findByDistribution(dist.universal, attrs.type)[0];
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
                    cancelLabel: 'Start New'
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
