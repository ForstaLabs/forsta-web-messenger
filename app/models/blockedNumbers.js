/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';
    self.Whisper = self.Whisper || {};
    storage.isBlocked = function(number) {
        return storage.get('blocked', []).indexOf(number) >= 0;
    };
})();
