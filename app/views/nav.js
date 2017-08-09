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

    F.NavConversationsView = F.ListView.extend({
        template: 'nav/conversations.html',
        holder: 'tbody',
        ItemView: F.NavConversationItemView,

        events: {
            'click thead': 'onHeaderClick',
            'click tfoot': 'onFootClick'
        },

        onHeaderClick: function(e) {
            console.log("asdasdasd");
        },

        onFootClick: function(e) {
            const visible = this.$('tbody').toggle().is(':visible');
            const icon = this.$('.f-collapse-icon');
            const text = this.$('#action');
            if (visible) {
              icon.removeClass('expand').addClass('collapse');
              text.text("Collapse");
            } else {
              icon.removeClass('collapse').addClass('expand');
              text.text("Expand");
            }
        }
    });

    F.NavAnnouncementsView = F.ListView.extend({
        template: 'nav/announcements.html',
        holder: 'tbody',
        ItemView: F.NavConversationItemView,

        events: {
            'click thead': 'onHeaderClick',
            'click tfoot': 'onFootClick'
        },

        onHeaderClick: async function(e) {
            // do from template here and with user card too
            let modalView = new F.ModalView({
                header: "Make announcement yo",
                icon: "announcement big red",
                content: `<div class="ui form">
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
        },

        onFootClick: function(e) {
            const visible = this.$('tbody').toggle().is(':visible');
            const icon = this.$('.f-collapse-icon');
            const text = this.$('#action');
            if (visible) {
              icon.removeClass('expand').addClass('collapse');
              text.text("Collapse");
            } else {
              icon.removeClass('collapse').addClass('expand');
              text.text("Expand");
            }
        }
    });
})();
