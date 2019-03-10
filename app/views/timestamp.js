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
            const relative = this.getRelativeTimeSpanString(timestamp);
            // Avoid DOM repaint caused by jQuery.text() when possible
            if (this._lastRelative !== relative) {
                this.$el.text(relative);
                this.$el.attr('title', moment(timestamp).format('llll'));
                this._lastRelative = relative;
            }
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
            const timestamp = moment(timestamp_);
            const timediff = moment.duration(moment() - timestamp);
            if (timediff.years() > 0) {
                this.delay = null;
                return timestamp.format(this._format.y);
            } else if (timediff.months() > 0 || timediff.days() > 6) {
                this.delay = null;
                return timestamp.format(this._format.M);
            } else if (timediff.days() > 0) {
                this.delay = null;
                return timestamp.format(this._format.d);
            } else if (timediff.hours() > 1) {
                this.delay = 300 * 1000;
                return this.relativeTime(timediff.hours(), 'h');
            } else if (timediff.hours() === 1) {
                this.delay = 60 * 1000;
                return this.relativeTime(timediff.hours(), 'h');
            } else if (timediff.minutes() > 1) {
                this.delay = 10 * 1000;
                return this.relativeTime(timediff.minutes(), 'm');
            } else if (timediff.minutes() === 1) {
                this.delay = 5 * 1000;
                return this.relativeTime(timediff.minutes(), 'm');
            } else {
                this.delay = 1000;
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
