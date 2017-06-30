/*
 * vim: ts=4:sw=4:expandtab
 */
;(function () {
    'use strict';

    self.F = self.F || {};

    const API = F.ccsm.getConfig().API;

    const syncMixin = {
        sync: async function(method, collection, options) {
            /* CCSM setup for API calls.  The options dict will be passed to
             * `jQuery.ajax`. */
            options.headers = options.headers || {};
            options.headers.Authorization = `JWT ${API.TOKEN}`;
            return await Backbone.sync(method, collection, options).promise();
        },

        urlRoot: function() {
            return API.URLS.BASE + this.urn;
        }
    };

    F.CCSMModel = Backbone.Model.extend(_.extend({
        url: function() {
            const url = Backbone.Model.prototype.url.call(this);
            return url + '/'; // CCSM/Django-Rest-Framework likes trailing slashes
        }
    }, syncMixin));

    F.CCSMCollection = Backbone.Collection.extend(_.extend({
        url: function() {
            return this.urlRoot();
        },
        parse: function(resp, options) {
            return resp.results;
        }
    }, syncMixin));
})();
