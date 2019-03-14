// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.AssertionError = class AssertionError extends Error {};

    F.assert = (assertion, message) => {
        if (!assertion) {
            debugger;
            throw new F.AssertionError(message);
        }
    };
})();
