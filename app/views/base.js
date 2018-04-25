// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function () {
    'use strict';

    self.F = self.F || {};

    const FViewOptions = [
        'template', // Path to template file following F.urls.templates/
    ];

    F.View = Backbone.View.extend({
        constructor: function(options) {
            _.extend(this, _.pick(options, FViewOptions));
            return Backbone.View.prototype.constructor.apply(this, arguments);
        },

        delegateEvents: function(events) {
            if (this._rendered) {
                events = events || _.result(this, 'events') || {};
                events['click .f-avatar-image.link'] = 'onAvatarLinkClick';
                events['click [data-user-card]'] = 'onUserCardClick';
                events['click [data-tag-card]'] = 'onTagCardClick';
                return Backbone.View.prototype.delegateEvents.call(this, events);
            } else {
                return this;
            }
        },

        render: async function(options) {
            options = options || {};
            const html = await this.render_template();
            if (this._rendered && html === this._lastRender && !options.forcePaint) {
                return this;
            }
            this._lastRender = html;
            if (html !== undefined) {
                for (const el of this.$el) {
                    el.innerHTML = html;
                }
            }
            this._rendered = true;
            this.delegateEvents();
            return this;
        },

        setElement: function() {
            /* Clear lastRender cache given that we have a new element to append to. */
            this._lastRender = null;
            return Backbone.View.prototype.setElement.apply(this, arguments);
        },

        render_template: async function() {
            if (!this._template && this.template) {
                this._template = await F.tpl.fetch(F.urls.templates + this.template);
            }
            if (this._template) {
                const attrs = await _.result(this, 'render_attributes', {});
                return this._template(attrs);
            }
        },

        render_attributes: function() {
            /* Return a shallow copy of the model attributes. */
            return Object.assign({}, _.result(this.model, 'attributes', {}));
        },

        onAvatarLinkClick: async function(ev) {
            ev.stopPropagation();  // Nested views produce spurious events.
            await this.showUserCard(ev.currentTarget.dataset.userId);
        },

        onUserCardClick: async function(ev) {
            ev.stopPropagation();  // Nested views produce spurious events.
            await this.showUserCard(ev.currentTarget.dataset.userCard);
        },

        onTagCardClick: async function(ev) {
            ev.stopPropagation();  // Nested views produce spurious events.
            await this.showTagCard(ev.currentTarget, ev.currentTarget.dataset.tagCard);
        },

        showUserCard: async function(id) {
            const user = await F.atlas.getContact(id);
            if (!user) {
                throw new ReferenceError("User not found: card broken");
            }
            await (new F.UserCardView({model: user})).show();
        },

        showTagCard: async function(anchorEl, id) {
            const tag = await F.atlas.getTag(id);
            const user = tag.get('user');  // Only on direct user tags.
            if (user) {
                const model = await F.atlas.getContact(user.id);
                await (new F.UserCardView({model})).show();
            } else {
                await (new F.TagCardView({anchorEl, tag, autoRemove: true})).show();
            }
        }
    }, {
        extend: function(props, staticProps) {
            if (this.prototype.events && props.events) {
                props.events = Object.assign({}, this.prototype.events, props.events);
            }
            return Backbone.View.extend.call(this, props, staticProps);
        }
    });
})();
