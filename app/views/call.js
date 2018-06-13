// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.CallView = F.View.extend({
        template: 'views/call.html',
        className: 'f-call',

        render_attributes: function() {
            return {
                thread: this.model
            };
        }
    });
})();
