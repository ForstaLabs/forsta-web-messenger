// vim: ts=4:sw=4:expandtab
/* global moment */

(function () {
    'use strict';

    self.F = self.F || {};

    moment.locale(navigator.language.split('-')[0]);

    F.TimestampView = F.View.extend({

        update: function() {
            this.clearTimeout();
            const timestamp = Math.min(Date.now(), Number(this.$el.data('timestamp')));
            if (!timestamp) {
                throw new Error("Missing timestamp");
            }
            this.$el.text(this.getRelativeTimeSpanString(timestamp));
            this.$el.attr('title', moment(timestamp).format('llll'));
            if (this.delay) {
                this.timeout = setTimeout(() => this.update(), Math.max(this.delay, 2500));
            }
        },

        clearTimeout: function() {
            if (this.timeout) {
                clearTimeout(this.timeout);
                this.timeout = null;
            }
        },

        getRelativeTimeSpanString: function(timestamp_) {
            // Convert to moment timestamp if it isn't already
            var timestamp = moment(timestamp_),
                timediff = moment.duration(moment() - timestamp);

            if (timediff.years() > 0) {
                this.delay = null;
                return timestamp.format(this._format.y);
            } else if (timediff.months() > 0 || timediff.days() > 6) {
                this.delay = null;
                return timestamp.format(this._format.M);
            } else if (timediff.days() > 0) {
                this.delay = moment(timestamp).add(timediff.days() + 1,'d').diff(moment());
                return timestamp.format(this._format.d);
            } else if (timediff.hours() > 1) {
                this.delay = moment(timestamp).add(timediff.hours() + 1,'h').diff(moment());
                return this.relativeTime(timediff.hours(), 'h');
            } else if (timediff.hours() === 1) {
                this.delay = moment(timestamp).add(timediff.hours() + 1,'h').diff(moment());
                return this.relativeTime(timediff.hours(), 'h');
            } else if (timediff.minutes() > 1) {
                this.delay = moment(timestamp).add(timediff.minutes() + 1,'m').diff(moment());
                return this.relativeTime(timediff.minutes(), 'm');
            } else if (timediff.minutes() === 1) {
                this.delay = moment(timestamp).add(timediff.minutes() + 1,'m').diff(moment());
                return this.relativeTime(timediff.minutes(), 'm');
            } else {
                this.delay = moment(timestamp).add(1,'m').diff(moment());
                return this.relativeTime(timediff.seconds(), 's');
            }
        },

        relativeTime: function(t, string) {
            return moment.duration(t, string).humanize();
        },

        _format: {
            y: "ll",
            M: "MMM D",
            d: "ddd"
        }
    });

    F.ExtendedTimestampView = F.TimestampView.extend({
        relativeTime: function(t, string, isFuture) {
            return moment.duration(-1 * t, string).humanize(true);
        },

        _format: {
            y: "lll",
            M: "MMM D" + ' LT',
            d: "ddd LT"
        }
    });
})();
