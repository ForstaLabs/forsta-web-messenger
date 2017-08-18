/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.NavConversationItemView = F.View.extend({
        template: 'nav/conversation-item.html',
        tagName: 'tr',

        className: function() {
            return 'conversation-item ' + this.model.cid;
        },

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
            const us = F.currentUser.get('username');
            if (this.tags.length) {
                for (const tag of this.tags.models) {
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

    F.NavAnnouncementsView = NavView.extend({
        template: 'nav/announcements.html',
        ItemView: F.NavConversationItemView,

        events: {
            'click thead': 'onHeaderClick',
        },

        onHeaderClick: async function(e) {
            // do from template here and with user card too
            let modalView = new F.ModalView({
                header: "Make announcement yo",
                icon: "announcement big red",
                content: `<div class="ui form">
                              <div class="field">
                                <label>Recipients</label>
                                <input type="text">
                                </div>
                          </div>
                          <div class="ui divider"></div>
                          <div class="ui form">
                              <div class="field">
                                    <div class="ui menu">
                                        <a class="active item">
                                            <i class="font icon"></i>
                                            Font
                                        </a>
                                        <a class="item">
                                            <i class="cubes icon"></i>
                                            Markup
                                        </a>
                                        <a class="item">
                                            <i class="bomb icon"></i>
                                            Destruction
                                        </a>
                                        <a class="item">
                                            WAHAHAHAAAAAA
                                        </a>
                                    </div>
                                    <textarea></textarea>
                              </div>
                          </div>`,
                actions: [{
                    class: 'success green',
                    label: 'Send'}, {
                    class: 'success blue',
                    label: 'Preview'}, {
                    class: 'deny red',
                    label: 'Close'
                }],
            });
            await modalView.render();
            modalView.$('.f-announcement-compose').append();
            modalView.show();
        }
    });
})();
