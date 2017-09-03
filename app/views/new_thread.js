// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.NewThreadView = F.View.extend({

        initialize: function() {
            this.tags = F.foundation.getTags();
            this.users = F.foundation.getUsers();
            this.listenTo(this.tags, 'add remove change', this.onChange);
            this.listenTo(this.users, 'add remove change', this.onChange);
        },

        render: async function() {
            this.$panel = $('#f-new-thread-panel');
            this.$startNew = $('.f-start-new');
            this.$startNew.on('click', this.togglePanel.bind(this));
            this.$dropdown = this.$panel.find('.dropdown');
            this.$menu = this.$dropdown.find('.menu .menu');
            this.$buttons = this.$panel.find('.ui.buttons .button');
            this.$startButton = this.$panel.find('.f-start-button');
            this.$startButton.on('click', this.onStartClick.bind(this));
            this.$clearButton = this.$panel.find('.f-clear-button');
            this.$clearButton.on('click', this.onClearClick.bind(this));
            this.$searchInput = this.$panel.find('input[name="search"]');
            // Must use event capture here...
            this.$searchInput[0].addEventListener('keydown', this.onKeyDown.bind(this), true); // XXX
            this.$panel.find('.ui.search').search(); // XXX
            this.$dropdown.dropdown({
                fullTextSearch: true,
                onChange: this.onSelectionChange.bind(this),
                onHide: () => false, // Always active.
                onLabelCreate: this.onLabelCreate,
            });
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
            this.$dropdown.dropdown('show');
            this.$dropdown.dropdown('restore defaults');
            this.$searchInput.val('').focus();
            this.$startNew.find('i.icon.primary').removeClass('plus').addClass('minus');
            this.$startNew.find('i.icon.secondary').removeClass('pencil').addClass('minus');
            this.$panel.css({
                transition: 'max-height 600ms ease',
                maxHeight: '1000px'
            });
        },

        hidePanel: function() {
            /* Smoother animation by reseting max-height to current value first. */
            this.$panel.css({
                transition: '',
                maxHeight: this.$panel.height() + 'px'
            });
            requestAnimationFrame(() => {
                this.$panel.css({
                    transition: 'max-height 500ms ease',
                    maxHeight: '0'
                });
                this.$panel.css('max-height', '');
                this.$dropdown.dropdown('restore defaults');
                this.$startButton.find('i.icon').removeClass('loading notched circle').addClass('right arrow');
                this.$startNew.find('i.icon.primary').removeClass('minus').addClass('plus');
                this.$startNew.find('i.icon.secondary').removeClass('minus').addClass('pencil');
            });
        },

        onKeyDown: async function(ev) {
            if (ev.ctrlKey && ev.keyCode === /*enter*/ 13) {
                ev.preventDefault();
                await this.onStartClick();
            }
        },

        onChange: function() {
            this.loadData();
        },

        loadData: async function() {
            this.$menu.empty();
            const us = F.currentUser.getSlug();
            if (this.users.length) {
                this.$menu.append('<div class="header"><i class="icon users large"></i> Users</div>');
                for (const user of this.users.filter(x => x.id !== F.currentUser.id)) {
                    const slug = user.getSlug();
                    this.$menu.append(`<div class="item" data-value="@${slug}">` +
                                      `<img class="f-avatar ui image avatar" src="${(await user.getAvatar()).url}"/>` +
                                      `<div class="slug">${user.getName()}</div>` +
                                      `<div class="description"><b>@</b>${slug}</div>` +
                                      '</div>');
                }
            }
            if (this.tags.length) {
                this.$menu.append('<div class="divider"></div>');
                this.$menu.append('<div class="header"><i class="icon tags large"></i> Tags</div>');
                for (const tag of this.tags.filter(x => !x.get('user') && x.get('slug') !== us)) {
                    const slug = tag.get('slug');
                    const members = tag.get('users').length ? `${tag.get('users').length} members` : '<i>empty</i>';
                    this.$menu.append(`<div class="item" data-value="@${slug}">` +
                                      `<div class="slug"><b>@</b>${slug}</div>` +
                                      `<div class="description">${members}</span>` +
                                      '</div>');
                }
            }
        },

        onSelectionChange: function() {
            const raw = this.$dropdown.dropdown('get value');
            if (raw.trim()) {
                this.$buttons.removeClass('disabled');
                this.$startButton.addClass('primary');
            } else {
                this.$startButton.removeClass('primary');
                this.$buttons.addClass('disabled');
            }
            this.$searchInput.val('').focus();
        },

        onStartClick: async function() {
            this.$startButton.find('.icon').removeClass('right arrow').addClass('loading notched circle');
            try {
                await this.startThread();
            } finally {
                this.hidePanel();
            }
        },

        onClearClick: async function() {
            this.$dropdown.dropdown('restore defaults');
        },

        startThread: async function() {
            const raw = this.$dropdown.dropdown('get value');
            if (!raw || !raw.trim().length) {
                return;
            }

            const threads = F.foundation.getThreads();
            const thread = await threads.ensure(raw, {type: 'conversation'});
            F.mainView.openThread(thread);
        }
    });
})();
