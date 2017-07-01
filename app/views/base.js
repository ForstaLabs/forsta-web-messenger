/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    const FViewOptions = [
        'template', // Path to template file following F.urls.templates/
        'templateRootAttach' // Use template's root element(s) for the $el prop.
    ];

    F.View = Backbone.View.extend({

        constructor: function(options) {
            _.extend(this, _.pick(options, FViewOptions));
            return Backbone.View.prototype.constructor.apply(this, arguments);
        },

        /* Defer creation of $el if configured to attach template to root. */
        _ensureElement: function() {
            if (this.templateRootAttach && !this._rendered) {
                return; // Defer element assignment to render().
            } else {
                Backbone.View.prototype._ensureElement.call(this);
            }
        },
            
        delegateEvents: function() {
            if (this._rendered) {
                return Backbone.View.prototype.delegateEvents.call(this);
            } else {
                return this;
            }
        },

        render: async function() {
            if (!this._template && this.template) {
                this._template = await F.tpl.fetch(F.urls.templates + this.template);
            }
            if (this._template) {
                let attrs = _.result(this, 'render_attributes', {});
                if (attrs instanceof Promise) {
                    attrs = await attrs;
                }
                const html = this._template(attrs);
                if (this.templateRootAttach) {
                    /* Copypasta from _ensureElement to graft extr attrs
                     * onto our new root el. */
                    const el_attrs = _.extend({}, _.result(this, 'attributes'));
                    if (this.id) {
                        el_attrs.id = _.result(this, 'id');
                    }
                    if (this.className) {
                        el_attrs['class'] = _.result(this, 'className');
                    }
                    const $el = $(html);
                    $el.attr(el_attrs);
                    this.setElement($el, /*delegateEvents*/ false);
                } else {
                    this.$el.html(html);
                }
            }
            this._rendered = true;
            this.delegateEvents();
            return this;
        },

        render_attributes: function() {
            return _.result(this.model, 'attributes', {});
        }
    });
})();
