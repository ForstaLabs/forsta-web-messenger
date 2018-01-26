// vim: ts=4:sw=4:expandtab
/* global  */

(function () {
    'use strict';

    self.F = self.F || {};

    F.SettingsView = F.View.extend({
        template: 'views/settings.html',
        className: 'f-settings-view ui modal tiny',

        events: {
            'click .actions .button.f-dismiss': 'onDismissClick',
            'click .button.f-storage-persist': 'onStoragePersistClick',
            'click .button.f-notif-request': 'onNotifRequestClick'
        },

        render_attributes: async function() {
            const storage = navigator.storage;
            return {
                notificationPermission: Notification.permission,
                notificationSoundMuted: await F.state.get("notificationSoundMuted"),
                allowBugReporting: !(await F.state.get("disableBugReporting")),
                allowUsageReporting: !(await F.state.get("disableUsageReporting")),
                hasPushNotifications: !!(await F.state.get('serverGcmHash')),
                deviceName: await F.state.get('name'),
                currentUser: F.currentUser.attributes,
                currentDevice: F.currentDevice,
                version: F.version,
                gitCommit: F.env.GIT_COMMIT.substring(0, 8),
                storageEstimate: storage && await storage.estimate(),
                persistentStorage: storage && await storage.persisted()
            };
        },

        show: async function() {
            await this.render();
            this.$el.modal('show');
            this.$('.ui.menu.tabular > .item').tab({context: this.el});
            this.$('.f-notif-setting').dropdown({
                onChange: this.onNotifSettingChange.bind(this)
            }).dropdown('set selected', await F.state.get('notificationSetting') || 'message');
            this.$('.f-notif-filter').dropdown({
                onChange: this.onNotifFilterChange.bind(this)
            }).dropdown('set selected', await F.state.get('notificationFilter'));
            this.$('.f-bug-reporting').checkbox({
                onChange: this.onBugReportingChange
            });
            this.$('.f-usage-reporting').checkbox({
                onChange: this.onUsageReportingChange
            });
            this.$('.f-notif-sound-muted').checkbox({
                onChange: this.onNotifSoundMutedChange
            });
            if (F.util.isSmallScreen()) {
                F.ModalView.prototype.addPushState.call(this);
            }
        },

        onNotifSettingChange: async function(value) {
            await F.state.put('notificationSetting', value);
        },

        onNotifFilterChange: async function(value) {
            await F.state.put('notificationFilter', value.split(',').filter(x => !!x));
        },

        onBugReportingChange: async function() {
            await F.state.put("disableBugReporting", !this.checked);
        },

        onUsageReportingChange: async function() {
            await F.state.put("disableUsageReporting", !this.checked);
        },

        onNotifRequestClick: async function() {
            const setting = await Notification.requestPermission();
            if (setting !== 'granted') {
                this.$('.f-notif-request').html("Rejected!").addClass('disabled');
            } else {
                await this.show();
            }
        },

        onNotifSoundMutedChange: async function() {
            await F.state.put("notificationSoundMuted", this.checked);
        },

        onDismissClick: function() {
            this.$el.modal('hide');
            this.remove();
        },

        onStoragePersistClick: async function() {
            if (!(await navigator.storage.persist())) {
                this.$('.f-storage-persist').html("Rejected!").addClass('disabled');
            }
            await this.show();
        }
    });
})();
