// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    async function main() {
        await F.cache.startSharedCache();
        await F.tpl.loadPartials();
        if (F.config.favicons) {
            $('#favicon').attr('href', F.config.favicons['normal']);
        }
        F.signinView = new F.SigninView({el: $('body')});
        F.util.chooseTheme(F.config.default_theme);
        await F.signinView.render();
    }

    addEventListener('load', main);
    addEventListener('dbblocked', () => location.reload());
    addEventListener('dbversionchange', () => location.reload());
})();
