// vim: ts=4:sw=4:expandtab
/* global relay moment mnemonic */

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
            this.$fab.on('click', '.f-share.icon', this.onShareClick.bind(this));
            this.$fabClosed = $('.f-start-new.f-closed');
            this.$fabClosed.on('click', 'i:first-child,i:nth-child(2)', this.togglePanel.bind(this));
            this.$dropdown = this.$panel.find('.f-start-dropdown');
            this.$panel.find('.f-header-menu .ui.dropdown').dropdown();
            this.$prioMenu = this.$dropdown.find('.f-priority.menu');
            this.$contactsMenu = this.$dropdown.find('.f-contacts.menu');
            this.$tagsMenu = this.$dropdown.find('.f-tags.menu');
            this.$searchInput = this.$panel.find('input[name="f-start-search"]');
            this.$searchInput.on('input', this.onSearchInput.bind(this));
            // Must use event capture here...
            this.$searchInput[0].addEventListener('keydown', this.onKeyDown.bind(this), true);
            this.dropdown = this.$dropdown.dropdown.bind(this.$dropdown);
            this.dropdown({
                fullTextSearch: 'exact',
                onChange: this.onSelectionChange.bind(this),
                onHide: () => false, // Always active.
                selector: {
                    text: '.f-active-holder > .text',
                    label: '.f-active-holder > .label',
                    remove: '.f-active-holder > .label > .delete.icon',
                },
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
            this.$panel.removeClass('expanded');
            this.resetState();
            this.adjustFAB();
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

        getValidContacts: function() {
            return this.contacts.filter(x => !x.get('pending') &&
                                             !x.get('is_monitor') &&
                                             !x.get('removed'));
        },

        loadData: async function() {
            return await F.queueAsync(this, this._loadData.bind(this));
        },

        _loadData: async function() {
            await Promise.all([this._loadContactsData(), this._loadTagsData()]);
        },

        _loadContactsData: async function() {
            const users = this.getValidContacts();
            if (!users.length) {
                this.$contactsMenu.html('');
                return;
            }
            let importLink = '';
            if (F.env.DISCOVER_GOOGLE_AUTH_CLIENT_ID) {
                importLink = '<a class="f-import-contacts">[Import Contacts]</a>';
            }
            const html = [`
                <div class="f-contacts-header header">
                    <i class="icon users"></i> Contacts
                    ${importLink}
                </div>
            `];

            const ranks = new Map(await Promise.all(users.map(async x => {
                const mentions = await F.counters.getAgeWeightedTotal(x, 'mentions');
                const messagesSent = await F.counters.getAgeWeightedTotal(x, 'messages-sent');
                return [x, (mentions * 10) + messagesSent];
            })));
            const prioUsers = users.filter(x => x.id !== F.currentUser.id);
            prioUsers.sort((a, b) => ranks.get(b) - ranks.get(a));
            prioUsers.length = Math.min(5, prioUsers.length);
            if (prioUsers.length) {
                html.push(`<div class="f-priority-header">Recent / Frequent...</div>`);
                html.push(`<div class="f-priority-submenu">`);
                await Promise.all(prioUsers.map(async user => {
                    const name = user.id === F.currentUser.id ? '<i>[You]</i>' : user.getName();
                    const tag = user.getTagSlug();
                    // Note that slug is hidden in the main view but is used when active.
                    // Also note the data-value must be unique, so we tweak it with white noise.
                    const waterMark = '    ';
                    html.push(`
                        <div class="item" data-value="${tag}${waterMark}" title="${tag}">
                            <div class="f-avatar f-avatar-image image link">
                                <img src="${await user.getAvatarURL()}"/>
                            </div>
                            <div class="slug">${name}</div>
                        </div>
                    `);
                }));
                html.push(`</div>`);
            }

            users.sort((a, b) => a.getTagSlug() < b.getTagSlug() ? -1 : 1);
            await Promise.all(users.map(async user => {
                const name = user.id === F.currentUser.id ? '<i>[You]</i>' : user.getName();
                const tag = user.getTagSlug();
                html.push(`
                    <div class="item" data-value="${tag}">
                        <div class="f-avatar f-avatar-image image">
                            <img src="${await user.getAvatarURL()}"/>
                        </div>
                        <div class="slug">${name}</div>
                        <div title="${tag}" class="description">${tag}</div>
                    </div>
                `);
            }));
            this.$contactsMenu.html(html.join(''));
        },

        _loadTagsData: async function() {
            if (!this.tags.length) {
                this.$tagsMenu.html('');
                return;
            }
            const ourSlug = F.currentUser.getTagSlug().substr(1);
            const groupTags = this.tags.filter(x => !x.get('user') && x.get('slug') !== ourSlug);
            const tagsMeta = await F.atlas.resolveTagsBatchFromCache(groupTags.map(
                x => '@' + x.get('slug')));
            const tagHtml = groupTags.map((tag, i) => {
                const slug = tag.get('slug');
                const memberCount = tagsMeta[i].userids.length;
                return memberCount ? `
                    <div class="item" data-value="@${slug}">
                        <div class="slug"><b>@</b>${slug}</div>
                        <div class="description">${memberCount} members</div>
                    </div>
                ` : null;
            }).filter(x => x);
            if (tagHtml.length) {
                this.$tagsMenu.html('<div class="header"><i class="icon tags"></i> Tags</div>' +
                                    tagHtml.join(''));
            }
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
            const dis = 'grey off';
            const en = 'green';
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
            await this.doComplete('@support:forsta.io');
        },

        doComplete: async function(expression) {
            const $icons = this.$fab.find('.f-complete.icon');
            const loadingClass = 'loading notched circle';
            for (const el of $icons) {
                const $el = $(el);
                $el.removeClass($el.data('icon')).addClass(loadingClass);
            }
            let completed;
            try {
                completed = (await this.startThread(expression) !== false);
            } finally {
                for (const el of $icons) {
                    const $el = $(el);
                    $el.removeClass(loadingClass).addClass($el.data('icon'));
                }
                if (completed) {
                    this.hidePanel();
                }
            }
        },

        onShareClick: async function() {
            this.hidePanel();
            const label = (await mnemonic.Mnemonic.factory()).phrase.split(' ').slice(0, 2).join('-');
            const thread = await F.foundation.allThreads.make(F.currentUser.getTagSlug(), {
                title: `Shared Conversation (${label})`
            });
            F.mainView.openThread(thread);
            const url = await F.util.shareThreadLink(thread);
            await thread.createMessage({
                type: 'clientOnly',
                safe_html: [
                    `Share this URL to invite others to this thread...`,
                    `<pre>${url}</pre>`
                ].join('')
            });
        },

        startThread: async function(expression) {
            if (!expression) {
                return;
            }
            const isAnnouncement = this.$panel.find('input[name="threadType"]').val() === 'announcement';
            const attrs = {
                type: isAnnouncement ? 'announcement' : 'conversation'
            };
            const threads = F.foundation.allThreads;
            if (isAnnouncement) {
                attrs.sender = F.currentUser.id;
                return await F.mainView.openThread(await threads.make(expression, attrs));
            }
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
            const similar = threads.findByDistribution(dist.universal, attrs.type).reverse();
            if (similar.length) {
                const plural = similar.length > 1;
                const items = await Promise.all(similar.map(async (x, i) =>
                    `<div class="item" data-index="${i}" title="Click to reuse this ${attrs.type}.">` +
                        `<div class="content" style="max-width: 100%;">` +
                            `<div class="header">${x.getNormalizedTitle()}</div>` +
                            `<div class="description" ` +
                                 `style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">` +
                                (x.get('lastMessage') ? `Last message: ${x.get('lastMessage')}` : '') +
                            `</div>` +
                            `<div class="meta">Last activity: ${moment(x.get('timestamp')).fromNow()}</div>` +
                            `<div class="meta">${await x.messages.totalCount()} message(s)</div>` +
                        `</div>` +
                    `</div>`));
                const modalPromise = F.util.confirmModal({
                    size: 'tiny',
                    header: `Use existing ${attrs.type}?`,
                    content:
                        `${similar.length} similar ${attrs.type}${plural ? 's were' : ' was'} found with ` +
                        `the same distribution.  Select one of the following if you would like to reuse it...` +
                        `<div class="ui items link divided"
                              style="padding: 1em 1em 0; font-size: 0.8em;">` +
                            items.join('') +
                        `</div>`,
                    confirmLabel: `Start a new ${attrs.type}`,
                    dismiss: false
                });
                let completed = false;
                modalPromise.view.on('show', view => {
                    view.$('.item').on('click', async ev => {
                        const thread = similar[$(ev.currentTarget).data('index')];
                        // Bump the timestamp given the interest level change.
                        await thread.save({timestamp: Date.now()});
                        await F.mainView.openThread(thread);
                        completed = true;  // Indicates that we can close the new-thread widget.
                        view.hide();
                    });
                });
                if (!(await modalPromise)) {
                    return completed;
                }
            }
            return await F.mainView.openThread(await threads.make(expression, attrs));
        }
    });
})();
