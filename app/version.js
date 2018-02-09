// vim: ts=4:sw=4:expandtab

(function() {
    self.F = self.F || {};
    F.version = F.env.VERSION;
    F.product = 'ForstaWeb';
    F.userAgent = [
        `${F.product}/${F.version}`,
        `(${F.env.GIT_COMMIT.substring(0, 10)})`,
        navigator.userAgent
    ].join(' ');

    if (self.jQuery && (!F.env || F.env.STACK_ENV !== 'prod')) {
        addEventListener('load', () => {
            const url = F.util.versionedURL(F.urls.static + 'stylesheets/prototype.css');
            $('head').append(`<link rel="stylesheet" href="${url}" type="text/css"/>`);
            if (F.env.STACK_ENV) {
                const colors = {
                    'dev': ['#b70909', 'white'],
                    'stage': ['#f4db22', 'black']
                }[F.env.STACK_ENV];
                $('head').append([
                    '<style>',
                        '#f-header-view .f-brand::after {',
                            `content: '${F.env.STACK_ENV.toUpperCase()}';`,
                            colors && `background-color: ${colors[0]};`,
                            colors && `color: ${colors[1]};`,
                        '}',
                    '</style>'
                ].join('\n'));
            }
        });
    }
})();
