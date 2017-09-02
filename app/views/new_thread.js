/*
 * vim: ts=4:sw=4:expandtab
 */
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
            this.$popupEl = $('#f-new-thread-popup');
            this.$popup = this.$('.f-start-new');
            this.$popup.popup({
                on: 'click',
                popup: this.$popupEl,
                movePopup: false,
                onShow: this.onShowPopup.bind(this)
            });
            this.$dropdown = this.$popupEl.find('.dropdown');
            this.$tagsMenu = this.$dropdown.find('.f-tags.menu');
            this.$usersMenu = this.$dropdown.find('.f-users.menu');
            this.$startButton = this.$popupEl.find('.f-start-button');
            this.$startButton.on('click', this.onStartClick.bind(this));
            // Must use event capture here...
            this.$popupEl.find('input')[0].addEventListener('keydown', this.onKeyDown.bind(this), true); // XXX
            this.$popupEl.find('.ui.search').search(); // XXX
            this.$dropdown.dropdown({
                fullTextSearch: true,
                preserveHTML: false,
                forceSelection: false,
                allowAdditions: true,
                onChange: this.onSelectionChange.bind(this),
                onHide: () => false // Always active.  Popup controls visibility.
            });
            await this.loadData();
            return this;
        },

        onShowPopup: function() {
            this.$dropdown.dropdown('show');
            this.$('input').val('').focus();
        },

        onKeyDown: function(ev) {
            if (ev.ctrlKey && ev.keyCode === /*enter*/ 13) {
                this.startThread();
                ev.preventDefault();
            }
        },

        onChange: function() {
            this.loadData();
        },

        loadData: async function() {
            this.$usersMenu.empty();
            const us = F.currentUser.getSlug();
            if (this.users.length) {
                for (const user of this.users.filter(x => x.id !== F.currentUser.id)) {
                    const slug = user.getSlug();
                    this.$usersMenu.append(`<div class="item" data-value="@${slug}">` +
                                           `<span class="description">${user.getName()}</span>` +
                                           `<img class="f-avatar ui image avatar" src="${(await user.getAvatar()).url}"/>@${slug}` +
                                           '</div>');
                }
            }
            this.$tagsMenu.empty();
            if (this.tags.length) {
                for (const tag of this.tags.filter(x => !x.get('user') && x.get('slug') !== us)) {
                    const slug = tag.get('slug');
                    this.$tagsMenu.append(`<div class="item" data-value="@${slug}">` +
                                          `<span class="description">${tag.get('users').length} members</span>` +
                                          `<i class="icon tag"></i>@${slug}` +
                                          '</div>');
                }
            }
        },

        onSelectionChange: function() {
            const raw = this.$dropdown.dropdown('get value');
            if (raw.trim()) {
                this.$startButton.removeClass('disabled').addClass('primary');
            } else {
                this.$startButton.removeClass('primary').addClass('disabled');
            }
        },

        onStartClick: async function() {
            const $icon = this.$startButton.find('.icon');
            $icon.removeClass('right arrow').addClass('loading notched circle');
            try {
                await this.startThread();
            } finally {
                this.$popup.popup('hide');
                this.$dropdown.dropdown('restore defaults');
                $icon.removeClass('loading notched circle').addClass('right arrow');
            }
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
