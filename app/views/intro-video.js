// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.IntroVideoView = F.ModalView.extend({
        template: 'views/intro-video.html',
        className: 'f-intro-video ui modal',

        initialize: function() {
            F.ModalView.prototype.initialize.apply(this, arguments);
            this.on('hidden', this.remove);
        }
    });
})();
