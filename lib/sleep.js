// vim: ts=4:sw=4:expandtab
/* global */

(function() {
    const ns = self.F = self.F || {};

    const _maxTimeout = 0x7fffffff;  // `setTimeout` max valid value.
    ns.sleep = async function(seconds) {
        let ms = seconds * 1000;
        while (ms > _maxTimeout) {
            // Support sleeping longer than the javascript max setTimeout...
            await new Promise(resolve => setTimeout(resolve, _maxTimeout));
            ms -= _maxTimeout;
        }
        return await new Promise(resolve => setTimeout(resolve, ms, seconds));
    };

    ns.never = function() {
        return new Promise(() => null);
    };
})();
