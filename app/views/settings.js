// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};

    F.SettingsView = F.ModalView.extend({
        template: 'views/settings.html',

        events: {
            'click .actions .button.f-dismiss': 'onDismissClick',
            //'click .actions .button.f-authorize': 'onAuthorizeClick',
            //'click .actions .button.f-save': 'onSaveClick',
            //'click .header .icon.link.checkmark': 'onToggleSelectionClick'
        },

        initialize: function() {
            F.ModalView.prototype.initialize.call(this, {
                size: 'tiny'
            });
        },

        /*selectStep: function(step) {
            this.$('[data-step]').hide();
            return this.$(`[data-step="${step}"]`).show();
        },*/

        show: async function() {
            await F.ModalView.prototype.show.apply(this, arguments);
            this.$('.ui.menu.tabular .item').tab();
            //this.$('.actions .button.f-save').hide();
            //this.selectStep(1);
            //if (!_googleApiInit) {
            //    _googleApiInit = initGoogleApi();
            //}
            //await _googleApiInit;
            //this.$('.actions .button.f-authorize').removeClass('disabled');
            return this;
        },

        onDismissClick: function() {
            this.hide();
            this.remove();
        }
    });
})();
