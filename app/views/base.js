/*
 * vim: ts=4:sw=4:expandtab
 *
 * F.View
 *
 * This is the base for most of our views. The Backbone view is extended
 * with some conveniences:
 *
 * 1. Parses handlebars templates.  (Must be preloaded with F.tpl.fetchAll)
 *
 * 2. Defines a default definition for render() which allows sub-classes
 * to simply specify a templateName and renderAttributes which are plugged
 * into  template rendering.
 *
 * 3. Provides some common functionality, e.g. confirmation dialog
 *
 */
(function () {
    'use strict';

    window.F = window.F || {};

    F.View = Backbone.View.extend({
        constructor: function(options) {
            const tpl = (options && options.templateName) || this.templateName;
            this.loadTemplate(tpl);
            Backbone.View.apply(this, arguments);
        },

        loadTemplate: function(ident) {
            if (ident) {
                this.template = F.tpl.get(ident);
            }
        },

        render_attributes: function() {
            return _.result(this.model, 'attributes', {});
        },

        render: function() {
            if (this.template) {
                var attrs = _.result(this, 'render_attributes', {});
                this.$el.html(this.template(attrs));
            }
            return this;
        },

        confirm: function(message) {
            return new Promise(function(resolve, reject) {
                var dialog = new Whisper.ConfirmationDialogView({
                    message: message,
                    resolve: resolve,
                    reject: reject
                });
                this.$el.closest('body').append(dialog.el);
            }.bind(this));
        },

        i18n_with_links: function() {
            var args = Array.prototype.slice.call(arguments);
            for (var i=1; i < args.length; ++i) {
              args[i] = 'class="link" href="' + encodeURI(args[i]) + '" target="_blank"';
            }
            return i18n(args[0], args.slice(1));
        }
    });
})();
