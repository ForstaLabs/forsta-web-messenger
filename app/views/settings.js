// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};

    F.SettingsView = F.View.extend({
        template: 'views/settings.html',
        className: 'ui modal',

        events: {
            'click .actions .button.f-dismiss': 'onDismissClick'
        },

        render_attributes: async function() {
            return {
                settings: {
                    notificationPermission: Notification.permission,
                    notificationSetting: await F.state.get('notificationSetting') || 'message',
                },
                privacy: {
                    allowBugReporting: await F.state.get("allowBugReporting"),
                    allowAnalytics: await F.state.get("allowAnalytics")
                },
                about: {
                    identity: (await F.state.get('ourIdentity')).pubKey,
                    hasGCM: !!(await F.state.get('serverGcmHash')),
                    deviceName: await F.state.get('name'),
                    currentUser: F.currentUser.attributes,
                    currentDevice: F.currentDevice,
                    version: F.version,
                    gitCommit: F.env.GIT_COMMIT,
                    storageEstimate: await navigator.storage.estimate(),
                    persistantStorage: await navigator.storage.persisted()
                }
            };
        },

        show: async function() {
            if (!this._rendered) {
                await this.render();
            }
            this.$el.modal('show');
            this.$('.ui.menu.tabular .item').tab();
        },

        onDismissClick: function() {
            this.$el.modal('hide');
            this.remove();
        }
    });
})();
