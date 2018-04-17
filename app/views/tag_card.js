// vim: ts=4:sw=4:expandtab
/* global */

(function () {
    'use strict';

    self.F = self.F || {};

    let _popupClickAwayBound;
    let _activePopup;

    function onClickAway(ev) {
        if (_activePopup) {
            _activePopup.hide(/*remove*/ true);
            _activePopup = null;
        }
    }

    // XXX move to it's own file or move to base.
    F.PopupView = F.View.extend({

        margin: 5,  // px

        initialize: function(options) {
            this.tag = options.tag;
            this.anchorEl = options.anchorEl;
            this.zIndex = 0;
            for (const x of $(this.anchorEl).parents()) {
                const z = parseInt($(x).css('z-index'));
                this.zIndex++;
                if (!isNaN(z)) {
                    this.zIndex += z;
                    break;
                }
            }
        },

        show: async function() {
            this.$el.css({
                left: '-10000px',
                zIndex: this.zIndex
            });
            this.$el.addClass('f-popup-view');
            await this.render();
            if (!_popupClickAwayBound) {
                $('body :not(.f-popup-view)').on('click', onClickAway);
                _popupClickAwayBound = true;
            }
            $('body').append(this.$el);
            const replace = !!(_activePopup && _activePopup.$(this.anchorEl).length);
            const pos = this.findPosition(replace);
            this.$el.hide().css(pos).transition(replace ? 'fade' : 'scale');
            if (_activePopup) {
                _activePopup.hide(/*remove*/ true);
                _activePopup = null;
            }
            _activePopup = this;
        },

        hide: async function(remove) {
            await new Promise(resolve => {
                this.$el.transition('fade', resolve);
            });
            if (remove) {
                this.remove();
            }
        },

        findPosition: function(replace) {
            const bodyWidth = document.body.clientWidth;
            const bodyHeight = document.body.clientHeight;
            const popupRect = this.el.getBoundingClientRect();
            let left;
            let top;
            if (replace) {
                const activeRect = _activePopup.el.getBoundingClientRect();
                const idealLeft = activeRect.left;
                const idealTop = activeRect.top;
                if (popupRect.width + idealLeft < bodyWidth) {
                    left = idealLeft;
                } else {
                    left = Math.max(0, bodyWidth - popupRect.width - this.margin);
                }
                if (popupRect.height + idealTop < bodyHeight) {
                    top = idealTop;
                } else {
                    top = Math.max(0, bodyHeight - popupRect.height - this.margin);
                }
                console.assert(left >= 0);
                console.assert(top >= 0);
                console.assert(left < bodyWidth);
                console.assert(top < bodyHeight);
                return {left, top};
            }
            const anchorRect = this.anchorEl.getBoundingClientRect();
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
            return {left, top};
        }
    });


    F.TagCardView = F.PopupView.extend({
        template: 'views/tag-card.html',

        render_attributes: async function() {
            const directMembers = new Set(await this.tag.getMembers(/*onlyDirect*/ true));
            const allMembers = await this.tag.getContacts();
            allMembers.sort((a, b) => b.getTagSlug() < a.getTagSlug() ? 1 : -1);
            return {
                tag: this.tag.attributes,
                slug: this.tag.getSlug(),
                children: await Promise.all((await this.tag.getChildren()).map(async x => ({
                    id: x.id,
                    tagSlug: x.getSlug(),
                    memberCount: (await x.getMembers()).length
                }))),
                totalMembers: (await this.tag.getMembers()).length,
                members: await Promise.all(allMembers.map(async x => Object.assign({
                    name: x.getName(),
                    avatar: await x.getAvatar(),
                    tagSlug: x.getTagSlug(),
                    direct: directMembers.has(x.id)
                }, x && x.attributes)))
            };
        }
    });
})();
