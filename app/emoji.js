/*
 * vim: ts=4:sw=4:expandtab
 */

;(function() {
    'use strict';

    EmojiConvertor.prototype.colons_to_unicode = function(str) {
        this.init_colons();
        return str.replace(this.rx_colons, function(m) {
            const idx = m.substr(1, m.length-2);
            const val = this.map.colons[idx];
            return val ? this.data[val][0][0] : m;
        }.bind(this));
    };

    window.emoji = new EmojiConvertor();
    emoji.include_title = true;
    emoji.img_sets.google.path = 'static/images/emoji/img-google-136/';
    emoji.img_set = 'google';
})();
