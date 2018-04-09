// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};

    let _popupClickAwayBound;
    let _activePopup;

    function onClickAway(ev) {
        if (_activePopup) {
            _activePopup.remove();
            _activePopup = null;
        }
    }

    // XXX move to it's own file or move to base.
    F.PopupView = F.View.extend({

        margin: 5,  // px

        initialize: function(options) {
            this.tag = options.tag;
            this.anchorEl = options.anchorEl;
        },

        show: async function() {
            await this.render();
            if (_activePopup) {
                _activePopup.remove();
                _activePopup = null;
            }
            this.$el.addClass('f-popup-view');
            if (!_popupClickAwayBound) {
                $('body :not(.f-popup-view)').on('click', onClickAway);
                _popupClickAwayBound = true;
            }
            _activePopup = this;
            $('body').append(this.$el);
            const pos = this.findPosition();
            this.$el.css(pos);
        },

        findPosition: function() {
            const bodyWidth = document.body.clientWidth;
            const bodyHeight = document.body.clientHeight;
            const popupRect = this.el.getBoundingClientRect();
            const anchorRect = this.anchorEl.getBoundingClientRect();
            let left;
            let top;
            if (popupRect.width + this.margin < anchorRect.left) {
                left = anchorRect.left - popupRect.width - this.margin;
            } else if (popupRect.width + this.margin < (bodyWidth - anchorRect.right)) {
                left = anchorRect.right + this.margin;
            } else if (popupRect.width < bodyWidth) {
                left = (bodyWidth - popupRect.width) / 2; // centered
            } else {
                console.warn("Popup too wide");
                left = this.margin;
            }
            if (popupRect.height < (bodyHeight - anchorRect.top)) {
                top = anchorRect.top;
            } else if (popupRect.height < bodyHeight) {
                top = bodyHeight - popupRect.height - this.margin;
            } else {
                console.warn("Popup too tall");
                top = this.margin;
            }
            console.assert(left >= 0);
            console.assert(top >= 0);
            console.assert(left < bodyWidth);
            console.assert(top < bodyHeight);
            return {
                left,
                top
            };
        }
    });


    F.TagCardView = F.PopupView.extend({
        template: 'views/tag-card.html',

        render_attributes: async function() {
            const members = await F.atlas.getContacts(this.tag.userids);
            return {
                tag: this.tag,
                members: await Promise.all(members.map(async x => Object.assign({
                    name: x ? x.getName() : '<Invalid User>',
                    avatar: x && await x.getAvatar(),
                    tagSlug: x && x.getTagSlug(),
                }, x && x.attributes))),
                memberCount: this.tag.userids.length
            };
        }
    });
})();
