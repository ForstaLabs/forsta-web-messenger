// vim: ts=4:sw=4:expandtab
/* global EmojiConvertor */

(function() {
    'use strict';

    self.F = self.F || {};

    EmojiConvertor.prototype.colons_to_unicode = function(str) {
        this.init_colons();
        return str.replace(this.rx_colons, function(m) {
            const idx = m.substr(1, m.length-2);
            const val = this.map.colons[idx];
            return val ? this.data[val][0][0] : m;
        }.bind(this));
    };

    F.emoji = new EmojiConvertor();
    F.emoji.include_title = true;
    F.emoji.img_sets.google.path = F.urls.static + 'images/emoji/google/64/';
    F.emoji.img_set = 'google';
})();
