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

        url: function() {
            return API.URLS.BASE + this.urn;
        },

        parse: function(resp, options) {
            return resp.results;
        }
    };

    F.CCSMModel = Backbone.Model.extend(syncMixin);
    F.CCSMCollection = Backbone.Collection.extend(syncMixin);
})();
