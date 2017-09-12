self.F = self.F || {};
F.version = '0.7.1';
F.product = 'ForstaWeb';

if (!forsta_env || forsta_env.STACK_ENV !== 'prod') {
    $('head').append('<link rel="stylesheet" href="/@static/stylesheets/dev.css" type="text/css"/>');
}
