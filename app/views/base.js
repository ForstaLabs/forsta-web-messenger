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
                events['click [data-user-card]'] = 'onUserCardClick';
                events['click [data-tag-card]'] = 'onTagCardClick';
                events['click [data-zendesk-card]'] = 'onZendeskCardClick';
                return Backbone.View.prototype.delegateEvents.call(this, events);
            } else {
                return this;
            }
        },

        render: async function(options) {
            options = options || {};
            const html = await this.renderTemplate(options.overrides);
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
            this.trigger('render', this);
            return this;
        },

        setElement: function() {
            /* Clear lastRender cache given that we have a new element to append to. */
            this._lastRender = null;
            return Backbone.View.prototype.setElement.apply(this, arguments);
        },

        renderTemplate: async function(overrides) {
            if (!this._template && this.template) {
                this._template = await F.tpl.fetch(F.urls.templates + this.template);
            }
            if (this._template) {
                const attrs = await _.result(this, 'render_attributes', {});
                return this._template(overrides ? Object.assign(attrs, overrides) : attrs);
            }
        },

        render_attributes: function() {
            /* Return a shallow copy of the model attributes. */
            return Object.assign({}, _.result(this.model, 'attributes', {}));
        },

        onUserCardClick: async function(ev) {
            ev.stopPropagation();  // Nested views produce spurious events.
            const $el = $(ev.currentTarget);
            const modalOptions = {allowMultiple: $el.hasClass('allow-multiple')};
            await F.util.showUserCard(ev.currentTarget.dataset.userCard, {modalOptions});
        },

        onTagCardClick: async function(ev) {
            ev.stopPropagation();  // Nested views produce spurious events.
            await F.util.showTagCard(ev.currentTarget.dataset.tagCard,
                                     {anchorEl: ev.currentTarget});
        },

        onZendeskCardClick: async function(ev) {
            ev.stopPropagation();  // Nested views produce spurious events.
            await F.util.showZendeskCard(ev.currentTarget.dataset.zendeskCard,
                                         {anchorEl: ev.currentTarget});
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
