// vim: ts=4:sw=4:expandtab
/* global  */

(function () {
    'use strict';

    self.F = self.F || {};

    F.SettingsView = F.View.extend({
        template: 'views/settings.html',
        className: 'ui modal tiny',

        events: {
            'click .actions .button.f-dismiss': 'onDismissClick',
            'click .button.f-storage-persist': 'onStoragePersistClick'
        },

        render_attributes: async function() {
            const storage = navigator.storage;
            return {
                privacy: {
                    allowBugReporting: await F.state.get("allowBugReporting"),
                    allowAnalytics: await F.state.get("allowAnalytics")
                },
                about: {
                    hasPushNotifications: !!(await F.state.get('serverGcmHash')),
                    deviceName: await F.state.get('name'),
                    currentUser: F.currentUser.attributes,
                    currentDevice: F.currentDevice,
                    version: F.version,
                    gitCommit: F.env.GIT_COMMIT.substring(0, 8),
                    storageEstimate: storage && await storage.estimate(),
                    persistentStorage: storage && await storage.persisted()
                }
            };
        },

        show: async function() {
            await this.render();
            this.$el.modal('show');
            this.$('.ui.menu.tabular .item').tab();
            const $notif = this.$('.f-notif-perm').checkbox({
                onChange: this.onNotifPermChange.bind(this)
            });
            if (Notification.permission === 'granted') {
                $notif.checkbox('check');
            }
            this.$('.f-notif-setting').dropdown({
                onChange: this.onNotifSettingChange.bind(this)
            }).dropdown('set selected', await F.state.get('notificationSetting') || 'message');
            this.$('.f-notif-filter').dropdown({
                onChange: this.onNotifFilterChange.bind(this),
                useLabels: false
            }).dropdown('set selected', await F.state.get('notificationFilter') || 'mention');

        },

        onNotifSettingChange: async function(value) {
            await F.state.put('notificationSetting', value);
        },

        onNotifFilterChange: async function(value) {
            await F.state.put('notificationFilter', value.split(','));
        },

        onNotifPermChange: async function() {
            const value = this.$('.f-notif-perm').checkbox('is checked');
            if (value) {
                const setting = await Notification.requestPermission();
                if (setting !== 'granted') {
                    const value = this.$('.f-notif-perm').checkbox('uncheck');
                }
            }
        },

        onDismissClick: function() {
            this.$el.modal('hide');
            this.remove();
        },

        onStoragePersistClick: async function() {
            if (!(await navigator.storage.persist())) {
                this.$('.f-storage-persist').html("Rejected by browser").addClass('disabled');
            }
            await this.show();
        }
    });
})();
