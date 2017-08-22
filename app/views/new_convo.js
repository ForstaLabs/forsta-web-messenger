/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.NewConvoView = F.View.extend({

        initialize: function() {
            this.listenTo(this.collection, 'add remove change', this.onChange);
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.$dropdown = this.$('.dropdown');
            this.$tagsMenu = this.$dropdown.find('.f-tags.menu');
            this.$startButton = this.$('.f-start.button');
            // Must use event capture here...
            this.$('input')[0].addEventListener('keydown', this.onKeyDown.bind(this), true);
            this.$('.ui.search').search();
            this.$dropdown.dropdown({
                fullTextSearch: true,
                preserveHTML: false,
                onChange: this.onSelectionChange.bind(this),
            });
            this.loadTags();
            return this;
        },

        events: {
            'click .f-start.button': 'onStartClick'
        },

        onKeyDown: function(ev) {
            if (ev.ctrlKey && ev.keyCode === /*enter*/ 13) {
                this.startConversation();
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
            this.startConversation();
        },

        startConversation: async function() {
            this.$dropdown.dropdown('hide');
            const raw = this.$dropdown.dropdown('get value');
            if (!raw || !raw.trim().length) {
                return;
            }
            this.$dropdown.dropdown('restore defaults');

            let expr = await F.ccsm.resolveTags(raw);
            if (expr.userids.indexOf(F.currentUser.id) === -1) {
                // Add ourselves to the group implicitly since the expression
                // didn't have a tag that included us.
                const ourTag = F.currentUser.get('tag').slug;
                expr = await F.ccsm.resolveTags(`(${raw}) + @${ourTag}`);
            }
            const threads = F.foundation.getThreads();
            let thread = threads.findWhere({
                distribution: expr.universal
            });
            if (!thread) {
                thread = await threads.make({
                    type: 'conversation',
                    distribution: expr.universal,
                    distributionPretty: expr.pretty
                });
            }
            F.mainView.openThread(thread);
        }
    });
})();
