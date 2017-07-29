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
            const us = F.currentUser.get('username');
            if (this.collection.length) {
                for (const tag of this.collection.models) {
                    const slug = tag.get('slug');
                    if (tag.get('users').length && slug !== us) {
                        this.$tagsMenu.append(`<div class="item" data-value="@${slug}">` +
                                              `<i class="icon user"></i>@${slug}</div>`);
                    }
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

            let expr = await this.collection.compileExpression(raw);
            if (expr.users.indexOf(F.currentUser.id) === -1) {
                // Add ourselves to the group implicitly since the expression
                // didn't have a tag that included us.
                const usToo = `(${raw}) + @${F.currentUser.get('username')}`;
                expr = await this.collection.compileExpression(usToo);
            }
            const conversations = F.foundation.getConversations();
            let convo = conversations.findWhere({
                distribution: expr.normalized.presentation
            });
            if (!convo) {
                const userIds = new Set(expr.users);
                const type = userIds.size > 2 ? 'group' : 'private';
                let name;
                if (type === 'private') {
                    const utmp = new Set(userIds);
                    utmp.delete(F.currentUser.id);
                    const them = F.foundation.getUsers().get(Array.from(utmp)[0]);
                    name = them.getName();
                } else {
                    name = expr.normalized.presentation;
                }

                convo = await conversations.make({
                    type,
                    name,
                    users: expr.users,
                    distribution: expr.normalized.presentation
                });
            }
            F.mainView.openConversation(convo);
        }
    });
})();
