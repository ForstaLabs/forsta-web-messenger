// vim: ts=4:sw=4:expandtab

(function() {
    self.F = self.F || {};
    F.version = '0.17.1';
    F.product = 'ForstaWeb';

    if (self.jQuery && (!F.env || F.env.STACK_ENV !== 'prod')) {
        $('head').append('<link rel="stylesheet" href="/@static/stylesheets/dev.css" type="text/css"/>');
    }
})();
