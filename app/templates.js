// vim: ts=4:sw=4:expandtab
/* global moment, Handlebars */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.tpl = {
        help: {}
    };
    const _tpl_cache = {};
    const cacheVersion = F.env.GIT_COMMIT.substring(0, 8);

    ns.fetch = async function(url) {
        url += '?v=' + cacheVersion;
        if (!_tpl_cache.hasOwnProperty(url)) {
            _tpl_cache[url] = (async function() {
                return Handlebars.compile(await ns._fetch(url));
            })();
        }
        try {
            return await _tpl_cache[url];
        } catch(e) {
            /* Don't cache exceptions */
            delete _tpl_cache[url];
            throw e;
        }
    };

    ns._fetch = F.cache.ttl(86400 * 30, async function template_fetch(url) {
        const resp = await fetch(url);
        const text = await resp.text();
        if (!resp.ok) {
            throw new Error(`Template load error: ${text}`);
        }
        return text;
    }, {store: 'shared_db'});

    ns.registerPartial = function(name, template) {
        return Handlebars.registerPartial(name, template);
    };

    ns.loadPartials = async function() {
        const partials = {
            "f-avatar": 'util/avatar.html'
        };
        const loading = [];
        for (const x in partials) {
            loading.push(ns.fetch(F.urls.templates + partials[x]).then(tpl =>
                         ns.registerPartial(x, tpl)));
        }
        await Promise.all(loading);
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

    ns.help.fromnowshort = function(val) {
        return moment(val).fromNow(true);
    };

    ns.help.datetime = function(val) {
        return moment(val).toString();
    };

    ns.help.humantime = function(ms) {
        const seconds = ms / 1000;
        if (seconds >= 0 && seconds < 60) {
            // Slightly better results for sub minute resolutions...
            if (seconds < 5) {
                return 'now';
            } else {
                return `${Math.round(seconds)} seconds`;
            }
        }
        return moment.duration(ms).humanize();
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

    ns.help.ifgt = function(left, right, options) {
        if (typeof left !== typeof right) {
            console.warn("Left and right values not same type:", left, right);
        }
        if (left > right) {
            return options.fn(this);
        } else {
            return options.inverse(this);
        }
    };

    ns.help.ifgte = function(left, right, options) {
        if (typeof left !== typeof right) {
            console.warn("Left and right values not same type:", left, right);
        }
        if (left >= right) {
            return options.fn(this);
        } else {
            return options.inverse(this);
        }
    };

    ns.help.iflt = function(left, right, options) {
        if (typeof left !== typeof right) {
            console.warn("Left and right values not same type:", left, right);
        }
        if (left < right) {
            return options.fn(this);
        } else {
            return options.inverse(this);
        }
    };

    ns.help.iflte = function(left, right, options) {
        if (typeof left !== typeof right) {
            console.warn("Left and right values not same type:", left, right);
        }
        if (left <= right) {
            return options.fn(this);
        } else {
            return options.inverse(this);
        }
    };

    ns.help.ifeq = function(left, right, options) {
        if (typeof left !== typeof right) {
            console.warn("Left and right values not same type:", left, right);
        }
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
        return JSON.stringify(val, null, 2);
    };

    ns.help.titlecase = function(val) {
        return val.replace(/\w\S*/g, s => s.charAt(0).toUpperCase() +
                                          s.substr(1).toLowerCase());
    };

    /*
     * Wire all the handlebars helpers defined here.
     * XXX Perhaps make app do this lazily so they can add more...
     */
    if (self.Handlebars) {
        // Optional: Does not exist in service worker.
        for (const key of Object.keys(ns.help)) {
            Handlebars.registerHelper(key, ns.help[key]);
        }
    }
})();
