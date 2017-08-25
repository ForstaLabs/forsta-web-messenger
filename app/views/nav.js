/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    F.NavItemView = F.View.extend({
        template: 'views/nav-item.html',
        tagName: 'tr',
        className: 'nav-item',

        events: {
            'click': 'select'
        },

        initialize: function() {
            const changeAttrs = [
                'title',
                'lastMessage',
                'unreadCount',
                'timestamp',
                'distribution'
            ].map(x => 'change:' + x);
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
                avatarProps: (await this.model.getAvatar()),
                titleNormalized: this.model.get('title') || this.model.get('distributionPretty')
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
        template: 'views/nav.html',
        ItemView: F.NavItemView
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
})();
