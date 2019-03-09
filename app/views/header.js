 // vim: ts=4:sw=4:expandtab
 /* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    const searchFromRe = /from:\s?"(.*?)"|from:\s?'(.*?)'|from:\s?([^\s]+)/i;
    const searchToRe = /to:\s?"(.*?)"|to:\s?'(.*?)'|to:\s?([^\s]+)/i;


    F.HeaderView = F.View.extend({
        template: 'views/header.html',

        initialize: function(options) {
            F.View.prototype.initialize.apply(this, arguments);
            this.searchable = !options.disableSearch;
            this.on('select-logout', this.onLogoutSelect);
            this.on('select-devices', this.onDevicesSelect);
            this.on('select-import-contacts', this.onImportContactsSelect);
            this.on('select-settings', this.onSettingsSelect);
            this.messageSearchResults = new F.MessageCollection();
            this._onBodyClick = this.onBodyClick.bind(this);
            if (!options.disableMonitorRecv) {
                this.monitorRecvIdle();
            }
        },

        events: {
            'click .f-toc': 'onTOCClick',
            'click .f-toc-menu .item[data-item]': 'onDataItemClick',
            'click .f-toc-menu .link': 'onLinkClick',
            'click .f-toc-menu a': 'onLinkClick',
            'click .f-search .ui.input .icon': 'onSearchClick',
            'blur .f-search .ui.input': 'onSearchBlur'
        },

        render_attributes: async function() {
            const isMainSite = !!F.mainView;
            return Object.assign({
                showSettings: isMainSite,
                showImportContacts: isMainSite,
                name: this.model.getName(),
                tagSlug: this.model.getTagSlug(/*forceFull*/ true),
                orgAttrs: (await this.model.getOrg()).attributes,
                avatar: await this.model.getAvatar({nolink: true}),
                admin: this.model.get('permissions').indexOf('org.administrator') !== -1,
                searchable: this.searchable
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            await this.updateAttention();
            this.$tocMenu = this.$('.f-toc-menu');
            if (this.searchable) {
                this.$search = this.$('.f-search .ui.search');
                this.uiSearch = this.$search.search.bind(this.$search);
                this.uiSearch({
                    type: 'category',
                    source: [], // Prevent attempts to use API
                    searchDelay: 400,
                    cache: false,
                    showNoResults: false,
                    maxResults: 0,
                    onSearchQuery: this.onSearchQuery.bind(this),
                    onSelect: this.onSearchSelect.bind(this),
                    onResultsAdd: html => !!html,  // Workaround local search empty results...
                    verbose: true,
                    selector: {
                        result: '.f-result'
                    }
                });
                this.$search.find('.prompt').on('keydown', ev => {
                    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
                        requestAnimationFrame(() => {
                            const active = this.$search.find('.active')[0];
                            if (active) {
                                active.scrollIntoView({block: 'nearest'});
                            }
                        });
                    }
                });
            }
            return this;
        },

        monitorRecvIdle: async function() {
            const msgRecv = F.foundation.getMessageReceiver();
            let loading;
            while (this.$el) {
                if (msgRecv.busy) {
                    await relay.util.sleep(1.5);  // Wait till it's VERY busy.
                    if (msgRecv.busy) {
                        this.$('.f-avatar.loader').addClass('active').attr('title', 'Receiving messages...');
                        loading = true;
                        await msgRecv.idle;
                    }
                } else {
                    if (loading) {
                        this.$('.f-avatar.loader').removeClass('active').removeAttr('title');
                        loading = false;
                    }
                    await relay.util.sleep(0.25);  // No busy event/promise to await.
                }
            }
        },

        onSearchBlur: function() {
            // XXX Debounce blur by click with timing hack...
            this.lastBlur = Date.now();
        },

        onSearchClick: function() {
            if (this.uiSearch('is focused')) {
                this.$('.f-search input').blur();
            } else if (Date.now() - (this.lastBlur || 0) > 100) {
                this.$('.f-search input').focus();
            }
        },

        onSearchQuery: async function(query) {
            if (query.length < 3) {
                this.uiSearch('display message', 'Need more input...');
                return;
            }
            this.uiSearch('set loading');
            try {
                await this._onSearchQuery(query);
            } finally {
                this.uiSearch('remove loading');
            }
        },

        _onSearchQuery: async function(query) {
            const fetchTemplate = F.tpl.fetch(F.urls.templates + 'util/search-results.html');
            const msgResults = this.messageSearchResults;
            const fromMatch = searchFromRe.exec(query);
            const criteria = [];
            if (fromMatch) {
                query = query.substr(0, fromMatch.index) +
                        query.substr(fromMatch.index + fromMatch[0].length);
                criteria.push({
                    index: 'from-ngrams',
                    criteria: fromMatch.slice(1).filter(x => x)[0]
                });
            }
            const toMatch = searchToRe.exec(query);
            if (toMatch) {
                query = query.substr(0, toMatch.index) +
                        query.substr(toMatch.index + toMatch[0].length);
                criteria.push({
                    index: 'to-ngrams',
                    criteria: toMatch.slice(1).filter(x => x)[0]
                });
            }
            const queryWords = query.split(/\s+/).map(x => x.toLowerCase()).filter(x => x);
            criteria.push({
                index: 'body-ngrams',
                criteria: query
            });
            console.debug("Search criteria:", criteria);
            const searchJob = msgResults.searchFetch(criteria, {
                sort: (a, b) => (b.sent || 0) - (a.sent || 0),
                filter: x => x.threadId && F.foundation.allThreads.get(x.threadId)
            });

            /* Look for near perfect contact matches. */
            const contactResults = queryWords.length ? F.foundation.getContacts().filter(c => {
                const names = ['first_name', 'last_name'].map(
                    x => (c.get(x) || '').toLowerCase()).filter(x => x);
                return queryWords.every(w => names.some(n => n.startsWith(w)));
            }) : [];

            /* Look for matching thread titles. */
            const threadResults = queryWords.length ? F.foundation.allThreads.filter(t => {
                let title = t.get('title');
                if (title) {
                    title = title.toLowerCase();
                    return queryWords.every(w => title.indexOf(w) !== -1);
                }
            }) : [];

            await searchJob;
            if (!msgResults.length && !contactResults.length && !threadResults.length) {
                this.uiSearch('display message', 'No matching messages or contacts found.', 'empty');
                return;
            }
            const messages = (await Promise.all(msgResults.map(async m => {
                if (m.get('type') === 'clientOnly') {
                    return;
                }
                const sender = await m.getSender();
                if (!sender) {
                    console.warn("Skipping message without sender:", m);
                    return;
                }
                const thread = await m.getThread();
                if (!thread) {
                    console.warn("Skipping message from archived thread:", m);
                    return;
                }
                return {
                    id: m.id,
                    senderName: sender.getName(),
                    threadTitle: thread.getNormalizedTitle(/*text*/ true),
                    avatarProps: await sender.getAvatar({nolink: true}),
                    sent: m.get('sent'),
                    plain: m.get('plain')
                };
            }))).filter(x => x);
            const contacts = await Promise.all(contactResults.map(async c => ({
                id: c.id,
                name: c.getName(),
                avatarProps: await c.getAvatar({nolink: true})
            })));
            const threads = await Promise.all(threadResults.map(async t => ({
                id: t.id,
                name: t.getNormalizedTitle(),
                avatarProps: await t.getAvatar({nolink: true})
            })));
            this.uiSearch('add results', (await fetchTemplate)({
                messages,
                contacts,
                threads
            }));
            requestAnimationFrame(() => {
                this.$search.find('.results').scrollTop(0);
            });
        },

        onSearchSelect: function(result) {
            const [type, id] = result.split(':');
            if (type === 'MESSAGE') {
                this.showMessage(this.messageSearchResults.get(id));
            } else if (type === 'CONTACT') {
                F.util.showUserCard(id);
                return false;  // Leave open and don't do anything else.
            } else if (type === 'THREAD') {
                console.info("Open thread:", id);
                F.mainView.openThreadById(id);
            }
        },

        showMessage: async function(message) {
            const thread = await message.getThread();
            if (!F.mainView.isThreadOpen(thread)) {
                await F.mainView.openThread(thread);
            } else if (F.util.isSmallScreen()) {
                // The nav bar may be obscuring the message pane if we're currently
                // selected on this thread and it's open.
                F.mainView.toggleNavBar(/*collapse*/ true);
            }
            const threadView = F.mainView.threadStack.get(thread);
            const threadType = thread.get('type');
            if (threadType === 'conversation') {
                const start = Date.now();
                await thread.messages.fetchToReceived(message.get('received'));
                console.info(`Loaded ${thread.messages.length} messages for search result in ${Date.now() - start}ms.`);
                const msgItem = await threadView.messagesView.waitAdded(message);
                await msgItem.rendered;
                console.debug(`Rendering ${thread.messages.length} messages for search result took ${Date.now() - start}ms.`);
                msgItem.$el.siblings().removeClass('search-match');
                msgItem.$el.addClass('search-match');
                threadView.messagesView.scrollIntoView(message);
                msgItem.$el.transition('pulse');
            } else if (threadType !== 'announcement') {
                console.error("Invalid thread type:", thread);
                throw new TypeError("Invalid thread type");
            }
        },

        updateAttention: async function() {
            const unreadCount = this.unread !== undefined ? this.unread :
                await F.state.get('unreadCount');
            const navCollapsed = this.navCollapsed !== undefined ? this.navCollapsed :
                await F.state.get('navCollapsed');
            const needAttention = !!(unreadCount && navCollapsed);
            const needFlash = this._lastUnreadCount !== undefined &&
                              this._lastUnreadCount !== unreadCount;
            this._lastUnreadCount = unreadCount;
            const $btn = this.$('.f-toggle-nav.button');
            $btn.toggleClass('attention', needAttention);
            if (needAttention) {
                $btn.attr('title', `${unreadCount} unread messages`);
                if (needFlash) {
                    navigator.vibrate && navigator.vibrate(200);
                    $btn.transition('pulse');
                }
            } else {
                $btn.attr('title', `Toggle navigation view`);
            }
        },

        updateUnreadCount: function(unread) {
            this.unread = unread;
            this.updateAttention();  // bg okay
        },

        updateNavCollapseState: function(collapsed) {
            this.navCollapsed = collapsed;
            this.updateAttention();  // bg okay
        },

        onTOCClick: function(ev) {
            ev.stopPropagation();  // Prevent clickaway detection from processing this.
            if (this.$tocMenu.hasClass('visible')) {
                this.hideTOC();
            } else {
                this.showTOC();
            }
        },

        hideTOC: function() {
            $('body').off('click', this._onBodyClick);
            this.$tocMenu.removeClass('visible');
        },

        showTOC: function() {
            this.$tocMenu.addClass('visible');
            $('body').on('click', this._onBodyClick);
        },

        onDataItemClick: function(ev) {
            const item = ev.currentTarget.dataset.item;
            if (item) {
                this.trigger(`select-${item}`);
            } else {
                console.warn("Bad toc menu item", ev.currentTarget);
            }
        },

        onLinkClick: function() {
            this.hideTOC();
        },

        onBodyClick: function(ev) {
            /* Detect clickaway */
            if (!$(ev.target).closest(this.$tocMenu).length) {
                this.hideTOC();
            }
        },

        onLogoutSelect: async function(e) {
            await F.util.confirmModal({
                icon: 'sign out',
                header: 'Sign out of Forsta Messenger?',
                size: 'tiny',
                confirmClass: 'red'
            }) && await F.atlas.signout();
        },

        onDevicesSelect: async function(e) {
            await (new F.LinkedDevicesView()).show();
        },

        onImportContactsSelect: async function(e) {
            await (new F.ImportContactsView()).show();
        },

        onSettingsSelect: async function(e) {
            await (new F.SettingsView()).show();
        }
    });
})();
