// vim: ts=4:sw=4:expandtab
/* global relay */

(function () {
    'use strict';

    self.F = self.F || {};

    F.SigninView = F.View.extend({

        splashImages: [
            'pexels-photo-desktop.jpeg',
            'pexels-photo-desktop_texting.jpeg',
            'pexels-photo-taking_picture.jpeg',
            'pexels-photo-texting-work.jpeg',
            'pexels-photo-texting.jpeg',
            'pexels-photo-texting2.jpeg',
            'pexels-photo-texting3.jpeg',
            'pexels-photo-texting4.jpeg',
            'pexels-photo-texting5.jpeg',
            'pexels-photo-texting6.jpeg',
            'pexels-photo-texting7.jpeg',
            'pexels-photo-texting8.jpeg',
            'pexels-photo-texting9.jpeg',
            'pexels-photo-texting_hiptser.jpeg'
        ],

        render: async function() {
            this.rotateBackdrop();  // bg only
            await F.View.prototype.render.apply(this, arguments);
            const $form = this.$('.ui.form');
            $form.form({
                on: 'change',
                onInvalid: () => this.$('.submit.button').addClass('disabled'),
                onValid: () => {this.$('.submit.button').removeClass('disabled'),console.log('asdf')}
            });
            return this;
        },

        rotateBackdrop: async function() {
            while (true) {
                if (!this.$('.f-splash.column').is(':visible')) {
                    await relay.util.sleep(1);
                    continue;
                }
                const img = this.splashImages[Math.floor(Math.random() * this.splashImages.length)];
                const url = URL.createObjectURL(await F.util.fetchStaticBlob('images/' + img));
                const $curBack = this.$('.f-splash .backdrop');
                const $newBack = $('<div class="backdrop" style="opacity: 0"></div>');
                $newBack.css('background-image', `url('${url}')`);
                $newBack[0].bgUrl = url;
                $curBack.before($newBack);
                await F.util.waitTillNextAnimationFrame();
                const transitionDone = new Promise(resolve => $curBack.on('transitionend', resolve));
                $curBack.css('opacity', '0');
                await F.util.waitTillNextAnimationFrame();
                $newBack.css('opacity', '1');
                await transitionDone;
                URL.revokeObjectURL($curBack[0].bgUrl);
                $curBack.remove();
                await relay.util.sleep(30);
            }
        }
    });
})();
