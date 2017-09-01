/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.NewThreadView = F.View.extend({

        initialize: function() {
            this.listenTo(this.collection, 'add remove change', this.onChange);
        },

        render: async function() {
            this.$newThread = $('#f-new-thread-popup');
            this.$('.f-start-new').popup({
                on: 'click',
                popup: this.$newThread,
                inline: false,
                movePopup: false,
                position: 'right center'
            });

            this.$dropdown = this.$newThread.find('.dropdown'); // XXX
            this.$tagsMenu = this.$dropdown.find('.f-tags.menu'); // XXX
            this.$startButton = this.$newThread.find('.f-start.button'); // XXX
            this.$startButton.on('click', this.onStartClick.bind(this));
            // Must use event capture here...
            this.$newThread.find('input')[0].addEventListener('keydown', this.onKeyDown.bind(this), true); // XXX
            this.$newThread.find('.ui.search').search(); // XXX
            this.$dropdown.dropdown({
                fullTextSearch: true,
                preserveHTML: false,
                onChange: this.onSelectionChange.bind(this),
            });
            this.loadTags();
            return this;
        },

        onKeyDown: function(ev) {
            if (ev.ctrlKey && ev.keyCode === /*enter*/ 13) {
                this.startThread();
                ev.preventDefault();
            }
        },

        maybeActivate: function() {
            if (this._active) {
                return;
            }
            this.$dropdown.removeClass('disabled');
            this.$dropdown.find('> .icon.loading').attr('class', 'icon plus');
            this._active = true;
        },

        onChange: function() {
            this.loadTags();
        },

        loadTags: function() {
            this.$tagsMenu.empty();
            //const us = F.currentUser.get('username'); XXX CCSM BUG
            if (this.collection.length) {
                for (const tag of this.collection.models) {
                    const slug = tag.get('slug');
                    // XXX CCSM BUG!!!!
                    //if (tag.get('users').length && slug !== us) {  // XXX CCSM is broken right now
                        this.$tagsMenu.append(`<div class="item" data-value="@${slug}">` +
                                              `<i class="icon user"></i>@${slug}</div>`);
                    //}
                }
                this.maybeActivate();
            }
        },

        onSelectionChange: function() {
            this.$startButton.removeClass('disabled');
            this.$('input').val('').focus();
        },

        onStartClick: function() {
            this.startThread();
        },

        startThread: async function() {
            this.$dropdown.dropdown('hide');
            const raw = this.$dropdown.dropdown('get value');
            if (!raw || !raw.trim().length) {
                return;
            }
            this.$dropdown.dropdown('restore defaults');

            const threads = F.foundation.getThreads();
            const thread = await threads.ensure(raw, {type: 'conversation'});
            F.mainView.openThread(thread);
        }
    });
})();
