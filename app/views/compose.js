// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    const TAB_KEY = 9;
    const ENTER_KEY = 13;
    const ESC_KEY = 27;
    const UP_KEY = 38;
    const DOWN_KEY = 40;

    const sendHistoryLimit = 20;
    const inputFilters = [];
    const selection = getSelection();

    if (!('isConnected' in window.Node.prototype)) {
        Object.defineProperty(window.Node.prototype, 'isConnected', {
            get: function() {
                return document.contains(this);
            }
        });
    }

    F.addComposeInputFilter = function(hook, callback, options) {
        /* Permit outsiders to impose filters on the composition of messages.
         * Namely this is useful for things like command switches .e.g.
         *
         *      /dosomething arg1 arg2
         *
         * The `hook` arg should be a regex to match your callback. Any matching
         * groups provided in the regex will be passed as arguments to the `callback`
         * function.  The above example would likely be configured as such...
         *
         *      F.addComposeInputFilter(/^\/dosomething\s+([^\s]*)\s+([^\s]*)/, myCallback);
         *
         * The callback function indicates that its action should override
         * the default composed message by returning alternate text.  This
         * text will be sent to the peers instead of what the user typed.
         */
        options = options || {};
        inputFilters.push({hook, callback, options});
        inputFilters.sort((a, b) => a.options.prio - b.options.prio);
    };

    F.getComposeInputFilters = function() {
        return inputFilters;
    };

    F.ComposeView = F.View.extend({
        template: 'views/compose.html',

        initialize: function() {
            window.compose = this;
            this.sendHistory = this.model.get('sendHistory') || [];
            this.sendHistoryOfft = 0;
            this.editing = false;
            this.onGiphyInputDebounced = _.debounce(this.onGiphyInput, 400);
            this.onEmojiInputDebounced = _.debounce(this.onEmojiInput, 400);
            this.emojiPicker = new F.EmojiPicker();
            this.emojiPicker.on('select', this.onEmojiSelect.bind(this));
            this.onClickAwayCompleter = this._onClickAwayCompleter.bind(this);
        },

        render_attributes: async function() {
            return Object.assign({
                titleNormalized: this.model.getNormalizedTitle(),
            }, await F.View.prototype.render_attributes.apply(this, arguments));
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.fileInput = new F.FileInputView({
                el: this.$('.f-files')
            });
            this.$('.f-emoji-picker-holder').append(this.emojiPicker.$el);
            this.fileInput.on('add', this.refresh.bind(this));
            this.fileInput.on('remove', this.refresh.bind(this));
            this.$placeholder = this.$('.f-input .f-placeholder');
            this.$msgInput = this.$('.f-input .f-message');
            this.msgInput = this.$msgInput[0];
            this.$sendButton = this.$('.f-send-action');
            this.$thread = this.$el.closest('.thread');
            this.$('.ui.dropdown').dropdown({
                direction: 'upward'
            });
            this.$('[data-html]').popup({on: 'click'});
            return this;
        },

        events: {
            'input .f-message': 'onComposeInput',
            'input .f-giphy input[name="giphy-search"]': 'onGiphyInputDebounced',
            'input .f-emoji input[name="emoji-search"]': 'onEmojiInputDebounced',
            'keydown .f-message': 'onComposeKeyDown',
            'click .f-send-action': 'onSendClick',
            'click .f-attach-action': 'onAttachClick',
            'click .f-giphy-action': 'onGiphyClick',
            'click .f-emoji-action': 'onEmojiClick',
            'focus .f-message': 'messageFocus',
            'click .f-message': 'captureSelection',
            'click .f-actions': 'redirectPlaceholderFocus',
            'blur .f-message': 'messageBlur',
            'click .f-giphy .remove.icon': 'onCloseGiphyClick',
            'click .f-emoji .remove.icon': 'onCloseEmojiClick'
        },

        captureSelection() {
            /* Manually copy the current selection range. (rangeClone is untrustable) */
            if (selection.type !== 'None') {
                const range = selection.getRangeAt(0);
                this.recentSelRange = {
                    startContainer: range.startContainer,
                    startOffset: range.startOffset,
                    endContainer: range.endContainer,
                    endOffset: range.endOffset
                };
            }
        },

        getCurrentWord() {
            const wordMeta = this.getCurrentWordMeta();
            if (wordMeta) {
                return wordMeta.word;
            }
        },

        getCurrentWordMeta() {
            if (!this.recentSelRange) {
                return;
            }
            let node = this.recentSelRange.endContainer;
            if (!node.isConnected) {
                return;
            }
            const offt = this.recentSelRange.endOffset;
            if (node.nodeName !== '#text') {
                if (offt) {
                    node = node.childNodes[offt - 1];
                }
                node = this.getLastChild(node);
            }
            const ctx = node.nodeValue || node.innerText || '';
            let start, end;
            for (start = offt; start > 0 && !ctx.substr(start - 1, 1).match(/\s/); start--) {/**/}
            for (end = offt; end < ctx.length && !ctx.substr(end, 1).match(/\s/); end++) {/**/}
            return {
                node,
                start,
                end,
                word: ctx.substring(start, end)
            };
        },

        restoreSelection(offset) {
            if (!this.recentSelRange) {
                return false;
            }
            const prevRange = this.recentSelRange;
            if (!prevRange.startContainer.isConnected || !prevRange.endContainer.isConnected) {
                return false;
            }
            offset = offset || 0;
            if (selection.type === 'None') {
                return false;
            }
            const range = selection.getRangeAt(0).cloneRange();
            try {
                range.setStart(prevRange.startContainer, prevRange.startOffset + offset);
                range.setEnd(prevRange.endContainer, prevRange.endOffset + offset);
            } catch(e) {
                if (e instanceof DOMException) {
                    // The DOM is live, sometimes we will fail if contents are changing.
                    return false;
                } else {
                    throw e;
                }
            }
            selection.removeAllRanges();
            selection.addRange(range);
            this.captureSelection();
            return true;
        },

        focusMessageField: function() {
            this.$msgInput.focus();
            if (!this.restoreSelection()) {
                this.selectEl(this.msgInput, {collapse: true});
            }
        },

        blurMessageField: function() {
            this.$msgInput.blur();
        },

        redirectPlaceholderFocus: function(ev) {
            this.focusMessageField();
        },

        messageFocus: function() {
            this.$el.addClass('focused');
        },

        messageBlur: function() {
            this.$el.removeClass('focused');
        },

        onSendClick: function(ev) {
            if (this._canSend) {
                this.send();
                ev.preventDefault();
                ev.stopPropagation();
            }
        },

        onCloseGiphyClick: function() {
            this.$('.f-giphy').removeClass('visible').find('.previews').empty();
        },

        onCloseEmojiClick: function() {
            this.$('.f-emoji').removeClass('visible');
        },

        processInputFilters: async function(text) {
            for (const filter of inputFilters) {
                const match = text.match(filter.hook);
                if (match) {
                    const args = match.slice(1, match.length);
                    const scope = filter.options.scope || this.model;
                    let result;
                    try {
                        result = await filter.callback.apply(scope, args);
                    } catch(e) {
                        console.error('Input Filter Error:', filter, e);
                        return {
                            clientOnly: true,
                            result: '<i class="icon warning sign red"></i>' +
                                    `<b>Command error: ${e}</b>`
                        };
                    }
                    // If the filter has a response, break here.
                    if (result === false) {
                        return {nosend: true};
                    } else {
                        return {
                            clientOnly: filter.options.clientOnly,
                            result
                        };
                    }
                }
            }
        },

        send: async function() {
            const raw = this.msgInput.innerHTML;
            const plain = F.emoji.colons_to_unicode(this.msgInput.innerText.trim());
            const processed = await this.processInputFilters(plain);
            let safe_html;
            if (processed) {
                if (processed.nosend) {
                    this.resetInputField(raw, /*noFocus*/ true);
                    return;
                } else if (processed.clientOnly) {
                    if (processed.result) {
                        await this.model.createMessage({
                            type: 'clientOnly',
                            safe_html: processed.result
                        });
                    }
                    this.resetInputField(raw);
                    return;
                } else {
                    safe_html = processed.result;
                }
            }
            if (!safe_html) {
                safe_html = F.util.htmlSanitize(F.emoji.colons_to_unicode(raw),
                                                /*render_forstadown*/ true);
            }
            if (plain.length + safe_html.length > 0 || this.fileInput.hasFiles()) {
                if (plain === safe_html) {
                    safe_html = undefined; // Reduce needless duplication if identical.
                }
                this.trigger('send', plain, safe_html, await this.fileInput.getFiles());
                this.addSendHistory(raw);
            }
            this.resetInputField();
        },

        resetInputField: function(histItem, noFocus) {
            if (histItem) {
                this.addSendHistory(histItem);  // bg okay
            }
            this.fileInput.removeFiles();
            this.msgInput.innerHTML = "";
            this.sendHistoryOfft = 0;
            this.editing = false;
            if (this.contactCompleter) {
                this.hideContactCompleter();
            }
            this.refresh();
            if (!noFocus) {
                this.focusMessageField();
            }
        },

        hasContent: function() {
            const text = this.msgInput.innerText;
            return !!(text && text !== '\n');
        },

        refresh: function() {
            const hasContent = this.hasContent();
            if (hasContent !== this._hasContent) {
                this._hasContent = hasContent;
                this.$placeholder.toggle(!hasContent);
            }
            const hasAttachments = this.fileInput.hasFiles();
            const canSend = hasContent || hasAttachments;
            if (canSend !== this._canSend) {
                this._canSend = canSend;
                this.$sendButton.toggleClass('enabled depth-shadow link', canSend);
            }
        },

        setLoading: function(loading) {
            this.$sendButton.toggleClass('loading circle notched', loading);
        },

        onAttachClick: function() {
            this.fileInput.openFileChooser();
        },

        onEmojiClick: async function(ev) {
            await this.emojiPicker.render();
            this.$('.f-emoji').addClass('visible');
            this.restoreSelection();
        },

        onEmojiSelect: function(emoji) {
            const emojiCode = F.emoji.colons_to_unicode(`:${emoji.short_name}:`);
            const endNode = this.recentSelRange && this.recentSelRange.endContainer;
            if (endNode && endNode.nodeName === '#text') {
                endNode.nodeValue = [
                    endNode.nodeValue.substr(0, this.recentSelRange.endOffset),
                    emojiCode,
                    endNode.nodeValue.substr(this.recentSelRange.endOffset)
                ].join('');
                this.restoreSelection(emojiCode.length);
            } else {
                this.msgInput.innerHTML += emojiCode;
            }
            this.refresh();
        },

        onGiphyClick: async function() {
            const $input = this.$('.f-giphy input[name="giphy-search"]');
            $input.val('');
            this.onGiphyInput(null, '');
            this.$('.f-giphy').addClass('visible');
            requestAnimationFrame(() => {$input.focus();});
        },

        onGiphyInput: async function(ev, override) {
            const $previews = this.$('.f-giphy .previews');
            const term = override !== undefined ? override : ev.currentTarget.value;
            if (!term) {
                $previews.html('Type in a search term above.');
                return;
            }
            let choices = await F.easter.giphy('PG-13', term, /*limit*/ 15);
            if (!choices.length) {
                $previews.html('No results found.');
                return;
            }
            const views = await Promise.all(choices.map(
                giphy => (new F.GiphyThumbnailView({composeView: this, giphy, term})).render()));
            $previews.empty();
            for (const x of views) {
                $previews.append(x.$el);
            }
        },

        onEmojiInput: async function(ev) {
            const terms = ev.target.value.toLowerCase().split(/[\s_\-,]+/).filter(x => !!x);
            return await this.emojiPicker.showSearchResults(terms);
        },

        onComposeInput: function() {
            this.editing = true;
            const dirty = this.msgInput.innerHTML;
            let clean;
            if (dirty === '<br>') {
                // Clear artifact of contenteditable that was edited and then cleared.
                clean = '';
            } else {
                clean = F.util.htmlSanitize(dirty);
                if (clean !== dirty) {
                    console.warn("Sanitizing input:", dirty, '->', clean);
                }
            }
            let altered;
            if (clean !== dirty) {
                this.msgInput.innerHTML = clean;
                altered = true;
            }
            const pure = F.emoji.colons_to_unicode(clean);
            if (pure !== clean) {
                this.msgInput.innerHTML = pure;
                altered = true;
            }
            requestAnimationFrame(() => this.onAfterComposeInput(altered));
        },

        onAfterComposeInput: async function(altered) {
            /* Run in anmiation frame context to get updated layout values. */
            if (altered) {
                this.selectEl(this.msgInput, {collapse: true});
            } else {
                this.captureSelection();
            }
            if (this.showContactCompleterSoon) {
                this.showContactCompleterSoon = false;
                await this.showContactCompleter();
            }
            if (this.contactCompleter) {
                const curWord = this.getCurrentWord();
                if (curWord && curWord.startsWith('@')) {
                    this.contactCompleter.search(curWord);
                } else {
                    this.hideContactCompleter();
                }
            }
            this.refresh();
        },

        selectEl: function(el, options) {
            const range = document.createRange();
            range.selectNodeContents(el);
            options = options || {};
            if (options.collapse) {
                range.collapse(options.head);
            }
            selection.removeAllRanges();
            selection.addRange(range);
            this.captureSelection();
        },

        onComposeKeyDown: function(ev) {
            this.showContactCompleterSoon = false;
            const keyCode = ev.which || ev.keyCode;
            if (!this.editing && this.sendHistory.length && (keyCode === UP_KEY || keyCode === DOWN_KEY)) {
                const offt = this.sendHistoryOfft + (keyCode === UP_KEY ? 1 : -1);
                this.sendHistoryOfft = Math.min(Math.max(0, offt), this.sendHistory.length);
                if (this.sendHistoryOfft === 0) {
                    this.msgInput.innerHTML = '';
                } else {
                    this.msgInput.innerHTML = this.sendHistory[this.sendHistory.length - this.sendHistoryOfft];
                    this.selectEl(this.msgInput);
                }
                this.refresh();
                return false;
            }
            const curWord = this.getCurrentWord();
            if (!curWord && ev.key === '@' && !this.contactCompleter) {
                // Must wait until after `input` event processing to get proper
                // cursor selection info.
                this.showContactCompleterSoon = true;
            } else if (this.contactCompleter) {
                if (keyCode === ENTER_KEY || keyCode === TAB_KEY) {
                    const selected = this.contactCompleter.selected;
                    if (selected) {
                        this.contactSubstitute(selected);
                    }
                } else if (keyCode === UP_KEY) {
                    this.contactCompleter.selectAdjust(-1);
                } else if (keyCode === DOWN_KEY) {
                    this.contactCompleter.selectAdjust(1);
                } else if (keyCode === ESC_KEY) {
                    this.hideContactCompleter();
                } else {
                    return;
                }
                return false;
            } else if (keyCode === ENTER_KEY && !(ev.altKey || ev.shiftKey || ev.ctrlKey)) {
                if (this.msgInput.innerText.split(/```/g).length % 2) {
                    // Normal enter pressed and we are not in literal mode.
                    if (this._canSend) {
                        this.send();
                    }
                    return false;
                }
            }
        },

        _onClickAwayCompleter: function(ev) {
            if (this.contactCompleter &&
                !$(ev.target).closest(this.contactCompleter.$el).length) {
                this.hideContactCompleter();
            }
        },

        showContactCompleter: async function() {
            const offset = this.getSelectionCoords();
            let horizKey = 'left';
            let horizVal = 0;
            if (offset && offset.x > this.$thread.width() / 2) {
                horizKey = 'right';
                horizVal = this.$thread.width() - offset.x;
            } else if (offset) {
                horizVal = offset.x - 12;
            }
            const contacts = new F.ContactCollection(await this.model.getContacts());
            const view = new F.ContactCompleterView({collection: contacts});
            view.$el.css({
                bottom: offset ? this.$thread.height() - offset.y : this.$el.height(),
                [horizKey]: horizVal
            });
            await view.render();
            if (this.contactCompleter) {
                this.contactCompleter.remove();
            } else {
                $('body').on('click', this.onClickAwayCompleter);
            }
            view.on('select', this.contactSubstitute.bind(this));
            this.contactCompleter = view;
            this.$thread.append(view.$el);
        },

        hideContactCompleter: function() {
            this.contactCompleter.remove();
            this.contactCompleter = null;
            $('body').off('click', this.onClickAwayCompleter);
        },

        getSelectionCoords: function() {
            let rect;
            if (selection.type !== 'None') {
                const range = selection.getRangeAt(0);
                rect = range.getBoundingClientRect();
                if (!rect || rect.x === 0) {
                    // Safari problems..
                    console.warn("Broken impl of Range.getBoundingClientRect detected!");
                    rect = range.getClientRects()[0];
                }
            }
            if (!rect || rect.x === 0) {
                // Fallback to last child of msg input.
                const node = this.getLastChild(this.msgInput, /*excludeText*/ true);
                rect = node.getBoundingClientRect();
            }
            const basisRect = this.$thread[0].getBoundingClientRect();
            return {
                x: rect.x - basisRect.x,
                y: rect.y - basisRect.y
            };
        },

        getLastChild: function(node, excludeText) {
            while (node.lastChild && (!excludeText || node.lastChild.nodeName !== '#text')) {
                node = node.lastChild;
            }
            return node;
        },

        addSendHistory: async function(value) {
            if (value && value.length < 1000) {
                this.sendHistory.push(value);
                while (this.sendHistory.length > sendHistoryLimit) {
                    this.sendHistory.shift();
                }
                await this.model.save('sendHistory', this.sendHistory);
            }
        },

        contactSubstitute: function(contact) {
            this.hideContactCompleter();
            const wordMeta = this.getCurrentWordMeta();
            if (!wordMeta || wordMeta.node.nodeName !== '#text') {
                console.warn("Could not substitute tag because current word selection is unavailable");
                return;
            }
            const beforeNode = wordMeta.node.cloneNode();
            const afterNode = wordMeta.node.cloneNode();
            beforeNode.nodeValue = beforeNode.nodeValue.substring(0, wordMeta.start);
            afterNode.nodeValue = afterNode.nodeValue.substring(wordMeta.end);
            const tagNode = document.createElement('span');
            tagNode.setAttribute('f-type', 'tag');
            tagNode.innerHTML = contact.getTagSlug();
            const padNode = document.createTextNode('\u00a0');
            const parentNode = wordMeta.node.parentNode;
            parentNode.replaceChild(afterNode, wordMeta.node);
            parentNode.insertBefore(padNode, afterNode);
            parentNode.insertBefore(tagNode, padNode);
            parentNode.insertBefore(beforeNode, tagNode);
            this.selectEl(padNode, {collapse: true});
        }
    });

    F.ContactCompleterView = F.View.extend({
        template: 'views/contact-completer.html',
        className: 'f-contact-completer ui segment',

        events: {
            'click .contact': 'onContactClick'
        },

        render_attributes: function() {
            if (this.searchTerm) {
                const models = this.collection.filter(
                    x => x.getTagSlug().indexOf(this.searchTerm) !== -1);
                this.filtered = new F.ContactCollection(models);
                if (this.selected && this.filtered.indexOf(this.selected) === -1) {
                    this.selected = null;
                }
            } else {
                this.filtered = this.collection;
            }
            if (!this.selected) {
                this.selected = this.filtered.at(0);
            }
            return this.filtered.map(x => Object.assign({
                tagSlug: x.getTagSlug(),
                selected: this.selected === x
            }, x.attributes));
        },

        search: async function(term) {
            this.searchTerm = term;
            await this.render();
        },

        selectAdjust: async function(offset) {
            const index = this.selected && this.filtered.indexOf(this.selected) || 0;
            const adjIndex = Math.max(0, Math.min(this.filtered.length - 1, index + offset));
            const newSelection = this.filtered.at(adjIndex);
            if (newSelection !== this.selected) {
                this.selected = newSelection;
                await this.render();
                const selectedEl = this.$(`.contact[data-id="${newSelection.id}"]`)[0];
                selectedEl.scrollIntoView(/*alignToTop*/ false);
            }
        },

        onContactClick(ev) {
            //ev.preventDefault();  // Prevent loss of focus on input bar.
            const id = ev.currentTarget.dataset.id;
            const contact = this.collection.get(id);
            this.trigger('select', contact);
        }
    });
})();
