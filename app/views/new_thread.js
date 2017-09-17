// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.NewThreadView = F.View.extend({

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
            this.$fab = $('.f-start-new.open');
            this.$fabClosed = $('.f-start-new.closed');
            this.$fab.on('click', this.togglePanel.bind(this));
            this.$fabClosed.on('click', this.togglePanel.bind(this));
            this.$dropdown = this.$panel.find('.f-start-dropdown');
            this.$panel.find('.f-header-menu .ui.dropdown').dropdown();
            this.$menu = this.$dropdown.find('.menu .menu');
            this.$fab.find('.f-complete.icon').on('click', this.onCompleteClick.bind(this));
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
                onLabelCreate: this.onLabelCreate
            });
            this.$announcement = this.$panel.find('.ui.checkbox');
            this.$announcement.checkbox();
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
                transition: 'max-height 600ms ease',
                maxHeight: '100vh'
            });
            if (!F.util.isTouchDevice) {
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
                    transition: 'max-height 500ms ease',
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
                    const expression = F.ccsm.sanitizeTags(this.dropdown('get query'));
                    ev.preventDefault();
                    ev.stopPropagation();
                    const $item = $(`<div class="item" data-value="${expression}">` +
                                    `<div class="slug">${expression}</div></div>`);
                    this.dropdown('set selected', expression, $item);
                    this.resetSearch();
                }
            }
        },

        onChange: async function() {
            await F.queueAsync(this, this.loadData.bind(this));
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
            const selected = this.dropdown('get value').trim();
            const input = F.ccsm.sanitizeTags(this.dropdown('get query'));
            if (selected && input) {
                return `${selected} ${input}`;
            } else {
                return selected || input;
            }
        },

        onSearchInput: function() {
            this.adjustFAB();
        },

        onSelectionChange: function() {
            this.resetSearch();
            this.adjustFAB();
            if (!F.util.isTouchDevice) {
                this.dropdown('focusSearch');
            }
        },

        adjustFAB: function() {
            if (this.getExpression()) {
                this.$fab.find('.f-complete.icon').removeClass('disabled grey').addClass('blue');
            } else {
                this.$fab.find('.f-complete.icon').removeClass('blue').addClass('disabled grey');
            }
        },

        onCompleteClick: async function() {
            const $icon = this.$fab.find('.f-complete.icon');
            const iconClass = $icon.data('icon');
            $icon.removeClass(iconClass).addClass('loading notched circle');
            try {
                await this.startThread();
            } finally {
                $icon.removeClass('loading notched circle').addClass(iconClass);
                this.hidePanel();
            }
        },

        startThread: async function() {
            const expression = this.getExpression();
            if (!expression) {
                return;
            }
            const is_announcement = this.$panel.find('input[name="threadType"]').val() === 'announcement';
            const type = is_announcement ? 'announcement' : 'conversation';
            const threads = F.foundation.getThreads();
            let thread;
            try {
                thread = await threads.ensure(expression, {type});
            } catch(e) {
                if (e instanceof ReferenceError) {
                    F.util.promptModal({
                        icon: 'warning sign red',
                        header: 'Failed to find or create thread',
                        content: e.toString()
                    });
                    return;
                } else {
                    throw e;
                }
            }
            await F.mainView.openThread(thread);
        }
    });
})();
