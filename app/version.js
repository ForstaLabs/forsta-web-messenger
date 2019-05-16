// vim: ts=4:sw=4:expandtab

(function() {
    self.F = self.F || {};
    F.product = F.electron ? 'ForstaMessenger' : 'ForstaWeb';
    F.userAgent = [
        `${F.product}/${F.version}`,
        `(${F.env.GIT_COMMIT.substring(0, 10)})`,
        navigator.userAgent
    ].join(' ');

    if (self.jQuery && (!F.env || F.env.STACK_ENV !== 'prod' && !F.electron)) {
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
            if (F.router) {
                if (F.env.STACK_ENV === 'stage') {
                    adjustFavicons(/*red*/ 3, /*green*/ 3);
                } else {
                    adjustFavicons(/*red*/ 2);
                }
            }
            if (F.config) {
                console.log('Found custom configuration');
                console.log(F.config);
                setCustomConfig();
            }
        });
    }

    async function setCustomConfig() {
        if (F.config.theme) {
            console.log(`Applying custom theme: ${F.config.theme}`);
            F.state.put('theme', F.config.theme);
        }
    }

    async function adjustFavicons(red, green, blue) {
        for (const category of ['normal', 'unread']) {
            const img = await F.util.getImage(F.router.getFaviconURL(category));
            const adjusted = await F.util.amplifyImageColor(img, red, green, blue);
            F.router.setFaviconURL(category, adjusted.src);
        }
    }
})();
