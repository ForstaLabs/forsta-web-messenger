/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.F = window.F || {};

    F.View = Backbone.View.extend({

        constructor: function(options) {
            _.extend(this, _.pick(options, ['templateUrl', 'templatePartials']));
            return Backbone.View.prototype.constructor.apply(this, arguments);
        },

        delegateEvents: function() {
            if (this._rendered) {
                return Backbone.View.prototype.delegateEvents.call(this);
            } else {
                return this;
            }
        },

        render: async function() {
            if (!this.template && this.templateUrl) {
                this.template = await F.tpl.fetch(this.templateUrl);
            }
            if (this.template) {
                const attrs = _.result(this, 'render_attributes', {});
                this.$el.html(this.template(attrs));
            }
            this._rendered = true;
            this.delegateEvents();
            return this;
        },

        render_attributes: function() {
            return _.result(this.model, 'attributes', {});
        },

        /*confirm: function(message) {
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
        }*/
    });
})();
