// vim: ts=4:sw=4:expandtab
/* global */

(function() {
    'use strict';

    function onLoad() {
        // Monkey patch default duration of all modals to be faster (default is 500).
        $.fn.modal.settings.duration = 250;

        /* Fix semantic modal clickaway support to work with multiple modals */
        const _modalSave = $.fn.modal;
        $.fn.modal = function modal() {
            const created = performance.now();
            const $modal = _modalSave.apply(this, arguments);
            const module = $modal.data('module-modal');

            if (!module._hasForstaOverride) {
                const clickSave = module.event.click;
                module.event.click = function(ev) {
                    if (ev.timeStamp < created) {
                        // This happens when the click event is from a modal that created us.
                        // So were literally responding to the same event that caused our existence.
                        // Just punt..
                        return;
                    }
                    const selector = $.fn.modal.settings.selector;  // Warning: this is only defaults. :(
                    const $target = $(ev.target);
                    const $targetModal = $target.closest(selector.modal);
                    if ($targetModal.length && !$targetModal.is($modal)) {
                        const targetZ = parseInt($targetModal.css('z-index'));
                        const ourZ = parseInt($modal.css('z-index'));
                        let targetIsBehind;
                        if (isNaN(targetZ) || isNaN(ourZ) || targetZ === ourZ) {
                            const $allModals = $modal.parent().children(selector.modal);
                            const targetPos = $allModals.index($targetModal);
                            if (targetPos === -1) {
                                console.error("Ambigous modal layering. PUNT");
                                return;
                            }
                            const ourPos = $allModals.index($modal);
                            targetIsBehind = ourPos > targetPos;
                        } else {
                            targetIsBehind = ourZ > targetZ;
                        }
                        if (targetIsBehind) {
                            module.hide();
                        }
                        return;
                    }
                    return clickSave.apply(this, arguments);
                };

                const hideModalSave = module.hideModal;
                module.hideModal = function() {
                    // Remove clickaway event listener on hide instead of waiting for hideDimmer.
                    // The event gets readded during showModal so this is more correct anyway.
                    module.remove.clickaway();
                    return hideModalSave.apply(this, arguments);
                };

                module._hasForstaOverride = true;
            }
            return $modal;
        };
        $.fn.modal.settings = _modalSave.settings;
    }

    addEventListener('load', onLoad);
})();
