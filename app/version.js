// vim: ts=4:sw=4:expandtab

(function() {
    self.F = self.F || {};
    F.version = '0.9.0';
    F.product = 'ForstaWeb';

    if (!F.env || F.env.STACK_ENV !== 'prod') {
        $('head').append('<link rel="stylesheet" href="/@static/stylesheets/dev.css" type="text/css"/>');
    }
})();
