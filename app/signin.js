// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function() {
    'use strict';

    async function main() {
        await Backbone.initDatabase(F.SharedCacheDatabase);
        await F.tpl.loadPartials();
        F.signinView = new F.SigninView({el: $('body')});
        await F.signinView.render();
    }

    addEventListener('load', main);
    addEventListener('dbblocked', () => location.reload());
    addEventListener('dbversionchange', () => location.reload());
})();
