// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.IntroVideoView = F.ModalView.extend({
        template: 'views/intro-video.html',

        events: {
            'click .actions .button.f-dismiss': 'onDismissClick'
        },

        initialize: function() {
            F.ModalView.prototype.initialize.call(this, {
                size: 'small',
                options: {
                    closable: false
                }
            });
        },

        onDismissClick: function() {
            this.hide();
            this.remove();
        }

    });
})();
