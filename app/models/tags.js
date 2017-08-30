// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.Tag = F.CCSMModel.extend({
        urn: '/v1/tag/',
        readCacheTTL: 3600
    });

    F.TagCollection = F.CCSMCollection.extend({
        model: F.Tag,
        urn: '/v1/tag/',
        readCacheTTL: 3600
    });
})();
