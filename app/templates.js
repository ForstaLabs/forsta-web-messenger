// vim: ts=4:sw=4:expandtab
/* global moment */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.tpl = {
        help: {}
    };
    const _tpl_cache = {};

    ns.fetch = async function(url) {
        if (!_tpl_cache.hasOwnProperty(url)) {
            _tpl_cache[url] = (async function() {
                const resp = await fetch(url);
                const text = await resp.text();
                if (!resp.ok) {
                    throw new Error(`Template load error: ${text}`);
                }
                return Handlebars.compile(text);
            })();
        }
        return await _tpl_cache[url];
    };

    ns.registerPartial = function(name, template) {
        return Handlebars.registerPartial(name, template);
    };

    ns.help.round = function(val, _kwargs) {
        const kwargs = _kwargs ? _kwargs.hash : {};
        const prec = kwargs.precision !== undefined ? kwargs.precision : 0;
        const sval = Number(val.toFixed(prec)).toLocaleString();
        if (sval.indexOf('.') === -1) {
            return sval;
        } else {
            return sval.replace(/0+$/, '').replace(/\.$/, '');
        }

    };

    ns.help.percent = function(val, _kwargs) {
        const sval = ns.help.round(val, _kwargs);
        return new Handlebars.SafeString(sval + '&nbsp;<small>%</small>');
    };

    ns.help.fromnow = function(val) {
        return moment(val).fromNow();
    };

    ns.help.datetime = function(val) {
        return moment(val).toString();
    };

    ns.help.humantime = function(val) {
        if (val >= 0 && val < 60) {
            // Slightly better results for sub minute resolutions...
            if (val <= 1.5) {
                return 'now';
            } else {
                return `${Math.round(val)} seconds`;
            }
        }
        return moment.duration(val, 'seconds').humanize();
    };

    ns.help.calendar = function(val) {
        return moment(val).calendar();
    };

    ns.help.time = function(val, _kwargs) {
        const buf = [];
        const n = Math.round(val);
        if (n > 86400) {
            buf.push(Math.floor(n / 86400).toLocaleString());
            buf.push('days, ');
        }
        buf.push(('0' + Math.floor((n % 86400) / 3600).toString()).slice(-2));
        buf.push(':');
        buf.push(('0' + Math.floor((n % 3600) / 60).toString()).slice(-2));
        buf.push(':');
        buf.push(('0' + (n % 60).toString()).slice(-2));
        return buf.join('');
    };

    ns.help.humanbytes = function(val, _kwargs) {
        let units = [
            [1024 * 1024 * 1024 * 1024, 'TB'],
            [1024 * 1024 * 1024, 'GB'],
            [1024 * 1024, 'MB'],
            [1024, 'KB'],
            [0, 'Bytes'],
        ];
        for (let i=0; i < units.length; i++) {
            const unit = units[i];
            if (Math.abs(val) >= unit[0]) {
                if (unit[0] !== 0)
                    val /= unit[0];
                const s = ns.help.round(val, _kwargs);
                return new Handlebars.SafeString([s, unit[1]].join(' '));
            }
        }
    };

    ns.help.humanint = function(val, _kwargs) {
        const units = [
            [1000000000000, 't'],
            [1000000000, 'b'],
            [1000000, 'm'],
            [1000, 'k'],
            [0, ''],
        ];
        for (let i=0; i < units.length; i++) {
            const unit = units[i];
            if (Math.abs(val) >= unit[0]) {
                if (unit[0] !== 0)
                    val /= unit[0];
                const s = ns.help.round(val, _kwargs);
                return new Handlebars.SafeString([s, '&nbsp;<small>', unit[1],
                                                 '</small>'].join(''));
            }
        }
    };

    ns.help.fixed = function(val, prec) {
        return val.toFixed(prec);
    };

    ns.help.ifeq = function(left, right, options) {
        if (left === right) {
            return options.fn(this);
        } else {
            return options.inverse(this);
        }
    };

    ns.help.ifneq = function(left, right, options) {
        if (left !== right) {
            return options.fn(this);
        } else {
            return options.inverse(this);
        }
    };

    ns.help.dump = function(val) {
        /* Debug helper to just dump raw values */
        return JSON.stringify(val);
    };

    /*
     * Wire all the handlebars helpers defined here.
     * XXX Perhaps make app do this lazily so they can add more...
     */
    for (const key of Object.keys(ns.help)) {
        Handlebars.registerHelper(key, ns.help[key]);
    }
})();
