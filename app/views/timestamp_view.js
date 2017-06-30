/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};

    moment.locale(navigator.language.split('-')[0]);

    Whisper.TimestampView = Whisper.View.extend({
        initialize: function(options) {
            window.addEventListener('beforeunload', this.clearTimeout.bind(this));
        },
        update: function() {
            this.clearTimeout();
            var millis_now = Date.now();
            var millis = this.$el.data('timestamp');
            if (millis === "") {
                return;
            }
            if (millis >= millis_now) {
                millis = millis_now;
            }
            var result = this.getRelativeTimeSpanString(millis);
            this.$el.text(result);

            var timestamp = moment(millis);
            this.$el.attr('title', timestamp.format('llll'));

            var millis_since = millis_now - millis;
            if (this.delay) {
                if (this.delay < 0) { this.delay = 1000; }
                this.timeout = setTimeout(this.update.bind(this), this.delay);
            }
        },
        clearTimeout: function() {
            clearTimeout(this.timeout);
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
        relativeTime : function (number, string) {
            return moment.duration(number, string).humanize();
        },
        _format: {
            y: "ll",
            M: "MMM D",
            d: "ddd"
        }
    });
    Whisper.ExtendedTimestampView = Whisper.TimestampView.extend({
        relativeTime : function (number, string, isFuture) {
            return moment.duration(-1 * number, string).humanize(string !== 's');
        },
        _format: {
            y: "lll",
            M: "MMM D" + ' LT',
            d: "ddd LT"
        }
    });
})();
