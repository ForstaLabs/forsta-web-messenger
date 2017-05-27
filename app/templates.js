/*
 * vim: ts=4:sw=4:expandtab
 */

;(function () {
    'use strict';

    window.F = window.F || {};
    F.tpl = {
        help: {}
    };
    const _tpl_cache = {};
    const _roots = {};

    F.tpl.load = async function(id) {
        if (_tpl_cache.hasOwnProperty(id)) {
            return _tpl_cache[id];
        }
        const tag = $(`script#${id}[type="text/x-template"]`);
        if (!tag.length) {
            throw new Error(`Template ID Not Found: ${id}`);
        } else if (tag.length > 1) {
            throw new RangeError('More than one template found');
        }
        const href = tag.attr('href');
        let tpl;
        if (href) {
            const resp = await fetch(href);
            const text = await resp.text();
            if (!resp.ok) {
                throw new Error(`Template load error: ${text}`);
            }
            tpl = text;
        } else {
            tpl = tag.html();
        }
        const entry = [tag, Handlebars.compile(tpl)];
        _tpl_cache[id] = entry;
        return entry;
    };
        
    F.tpl.render = async function(id, context) {
        const [tag, tpl] = await F.tpl.load(id);
        const html = tpl(context);
        const roots = $(html);
        if (_roots.hasOwnProperty(id)) {
            _roots[id].remove();
            delete _roots[id];
        }
        tag.after(roots);
        _roots[id] = roots;
        return roots;
    };

    F.tpl.help.round = function(val, _kwargs) {
        const kwargs = _kwargs.hash;
        const prec = kwargs.precision !== undefined ? kwargs.precision : 0;
        const sval = Number(val.toFixed(prec)).toLocaleString();
        if (sval.indexOf('.') === -1) {
            return sval;
        } else {
            return sval.replace(/0+$/, '').replace(/\.$/, '');
        }
        
    };

    F.tpl.help.percent = function(val, _kwargs) {
        const sval = F.tpl.help.round(val, _kwargs);
        return new Handlebars.SafeString(sval + '&nbsp;<small>%</small>');
    };

    F.tpl.help.fromnow = function(val) {
        return moment(val).fromNow();
    };

    F.tpl.help.humantime = function(val) {
        return moment.duration(val, 'seconds').humanize();
    };

    F.tpl.help.time = function(val, _kwargs) {
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

    F.tpl.help.humanbytes = function(val, _kwargs) {
        let units = [
            [1024 * 1024 * 1024 * 1024, 'TB'],
            [1024 * 1024 * 1024, 'GB'],
            [1024 * 1024, 'MB'],
            [1024, 'KB'],
            [0, ''],
        ];
        for (let i=0; i < units.length; i++) {
            const unit = units[i];
            if (Math.abs(val) >= unit[0]) {
                if (unit[0] !== 0)
                    val /= unit[0];
                const s = F.tpl.help.round(val, _kwargs);
                return new Handlebars.SafeString([s, '&nbsp;<small>', unit[1],
                                                 '</small>'].join(''));
            }
        }
    };

    F.tpl.help.humanint = function(val, _kwargs) {
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
                const s = F.tpl.help.round(val, _kwargs);
                return new Handlebars.SafeString([s, '&nbsp;<small>', unit[1],
                                                 '</small>'].join(''));
            }
        }
    };

    F.tpl.help.fixed = function(val, prec) {
        return val.toFixed(prec);
    };

    /*
     * Wire all the handlebars helpers defined here.
     * XXX Perhaps make app do this lazily so they can add more...
     */
    for (const key of Object.keys(F.tpl.help)) {
        Handlebars.registerHelper(key, F.tpl.help[key]);
    }

    F.tpl.View = Backbone.View.extend({
        constructor: async function(options) {
            const tpl_id = this.templateID || (options && options.templateID);
            if (tpl_id === undefined) {
                throw new Error("'templateID' prop/option required");
            }
            this._template = await F.tpl.load(this.templateID ||
                                                   options.templateID);
            Backbone.View.apply(this, arguments);
        },

        initialize: async function(options) {
            console.warn("Not Implemented");
        },

        render: function(context) {
            this.$el.html(this._template(this.model.attributes));
            return this;
        }
    });
})();
