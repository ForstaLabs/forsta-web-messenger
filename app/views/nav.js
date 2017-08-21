/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.NavItemView = F.View.extend({
        templateRootAttach: true,

        events: {
            'click': 'select'
        },

        initialize: function() {
            const changeAttrs = ['name', 'lastMessage', 'unreadCount', 'timestamp',
                                 'recipients'].map(x => 'change:' + x);
            this.listenTo(this.model, changeAttrs.join(' '),
                          _.debounce(this.render.bind(this), 200));
            this.listenTo(this.model, 'remove', this.remove);
            this.listenTo(this.model, 'opened', this.markSelected);
        },

        markSelected: function() {
            this.$el.addClass('active').siblings('.active').removeClass('active');
        },

        select: function() {
            this.markSelected();
            this.$el.trigger('select', this.model);
        },

        render_attributes: async function() {
            return Object.assign({
                avatarProps: (await this.model.getAvatar())
            }, F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            var unread = this.model.get('unreadCount');
            if (unread > 0) {
                this.$el.addClass('unread');
            } else {
                this.$el.removeClass('unread');
            }
            return this;
        }
    });

    F.NavConversationItemView = F.NavItemView.extend({
        template: 'nav/conversation-item.html',
    });

    F.NavAnnouncementItemView = F.NavItemView.extend({
        template: 'nav/announcement-item.html',
    });

    F.NavPollItemView = F.NavItemView.extend({
        template: 'nav/poll-item.html',
    });

    const NavView = F.ListView.extend({
        template: null, // Abstract
        ItemView: null, // Abstruct
        holder: 'tbody',

        initialize: function() {
            this.events = this.events || {};
            this.events['click tfoot'] = 'onFootClick';
            return F.ListView.prototype.initialize.apply(this, arguments);
        },

        onFootClick: function(e) {
            const visible = this.$('tbody').toggle().is(':visible');
            const $el = this.$('.expander');
            const $text = this.$('span');
            const $icon = $el.find('i');
            if (visible) {
              $icon.removeClass('expand').addClass('compress');
              $text.text("Collapse");
            } else {
              $icon.removeClass('compress').addClass('expand');
              $text.text("Expand");
            }
        }
    });

    F.NavConversationsView = NavView.extend({
        template: 'nav/conversations.html',
        ItemView: F.NavConversationItemView,

        render: async function() {
            await NavView.prototype.render.call(this);
            this.tags = F.foundation.getTags();
            this.$newConvo = $('#f-new-conversation-popup');
            this.$newConvo.find('.f-start-button').on('click', this.onStartClick);
            this.$('.f-start-new').popup({
                on: 'click',
                popup: this.$newConvo,
                inline: false,
                movePopup: false,
                position: 'right center'
            });

            this.$dropdown = this.$newConvo.find('.dropdown'); // XXX
            this.$tagsMenu = this.$dropdown.find('.f-tags.menu'); // XXX
            this.$startButton = this.$newConvo.find('.f-start.button'); // XXX
            // Must use event capture here...
            this.$newConvo.find('input')[0].addEventListener('keydown', this.onKeyDown.bind(this), true); // XXX
            this.$newConvo.find('.ui.search').search(); // XXX
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
            // const us = F.currentUser.get('username'); FUCKED
            if (this.tags.length) {
                for (const tag of this.tags.models) {
                    const slug = tag.get('slug');
                    // XXX CCSM is fucked right now.  Users is not being set!
                    //if (tag.get('users').length && slug !== us) {
                        this.$tagsMenu.append(`<div class="item" data-value="@${slug}">` +
                                              `<i class="icon user"></i>@${slug}</div>`);
                    //}
                }
                this.maybeActivate();
            }
        },

        onSelectionChange: function() {
            this.$startButton.removeClass('disabled');
            this.$newConvo.find('input').val('').focus(); // XXX
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

            let expr = await this.tags.compileExpression(raw);
            if (expr.users.indexOf(F.currentUser.id) === -1) {
                // Add ourselves to the group implicitly since the expression
                // didn't have a tag that included us.
                const usToo = `(${raw}) + @${F.currentUser.get('username')}`;
                expr = await this.tags.compileExpression(usToo);
            }
            const threads = F.foundation.getThreads();
            let thread = threads.findWhere({
                distribution: expr.normalized.universal
            });
            if (!thread) {
                convo = await threads.make({
                    type: 'conversation',
                    name,
                    users: expr.users,
                    distribution: expr.normalized.presentation
                });
            }
            F.mainView.openThread(thread);
        }
    });

    F.NavAnnouncementsView = NavView.extend({
        template: 'nav/announcements.html',
        ItemView: F.NavAnnouncementItemView,

        events: {
            'click thead': 'onHeaderClick'
        },

        onHeaderClick: async function(e) {
            new F.AnnouncementComposeView({
                header: "Make announcement yo",
                actions: [{
                    class: 'success green',
                    label: 'Send'}, {
                    class: 'approve blue',
                    label: 'Preview'}, {
                    class: 'deny red',
                    label: 'Close'
                }],
                options: {
                    onApprove: () => this.showPreview()
                }
            }).show();
        },

        showPreview: function() {
          throw new Error('XXX Merge error?');
          // probably needs to be written more good
          //const txt = $('.ini')[0].value;
          //const loc = $('.ui.segment.preview p');
          // XXX const conv = forstadown.inlineConvert(txt, new Set(["body"]));
          //loc.empty();
          //loc.append(conv);
          //return false;
        }
    });

    F.NavPollsView = NavView.extend({
        template: 'nav/polls.html',
        ItemView: F.NavPollItemView,

        events: {
            'click thead': 'onHeaderClick'
        },

        onHeaderClick: async function(e) {
            new F.AnnouncementComposeView({
                header: "Make announcement yo",
                actions: [{
                    class: 'success green',
                    label: 'Send'}, {
                    class: 'approve blue',
                    label: 'Preview'}, {
                    class: 'deny red',
                    label: 'Close'
                }],
                options: {
                    onApprove: () => this.showPreview()
                }
            }).show();
        },

        showPreview: function() {
          throw new Error('XXX Merge error?');
          // probably needs to be written more good
          //const txt = $('.ini')[0].value;
          //const loc = $('.ui.segment.preview p');
          // XXX const conv = forstadown.inlineConvert(txt, new Set(["body"]));
          //loc.empty();
          //loc.append(conv);
          //return false;
        }
    });
})();
