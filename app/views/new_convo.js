/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};

    const ENTER_KEY = 13;
    const TAB_KEY = 9;
    const UP_KEY = 38;
    const DOWN_KEY = 40;
    let dirty_flag = 0;

    F.NewConvoView = F.View.extend({

        render: async function() {
            await F.View.prototype.render.call(this);
            this.fileInput = new F.FileInputView({
                el: this.$('.f-files')
            });
            this.$messageField = this.$('.f-message');
            this.$('.ui.search').search();
            return this;
        },

        events: {
        }
    });
})();
