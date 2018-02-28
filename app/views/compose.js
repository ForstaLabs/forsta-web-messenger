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
    const allMetaTag = '@ALL';

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
                const range = selection.getRangeAt(0).cloneRange();
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
                if (!node) {
                    return;  // DOM race, it happens..
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
            this.closeGiphyDrawer();
        },

        closeGiphyDrawer: function() {
            this.$('.f-giphy').removeClass('visible').find('.previews').empty();
        },

        onCloseEmojiClick: function() {
            this.closeEmojiDrawer();
        },

        closeEmojiDrawer: function() {
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
                let mentions;
                const tags = new Set($.makeArray(this.$msgInput.find('[f-type="tag"]'))
                                     .map(x => x.innerText).filter(x => x));
                if (tags.size) {
                    if (tags.has(allMetaTag)) {
                        mentions = await this.model.getMembers();
                    } else {
                        const expr = Array.from(tags).join(' ');
                        const resolved = await F.atlas.resolveTagsFromCache(expr);
                        mentions = resolved.userids;
                    }
                }
                this.trigger('send', plain, safe_html, await this.fileInput.getFiles(), mentions);
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
            if (this.completer) {
                this.completer.hide();
            }
            this.refresh();
            if (!noFocus) {
                this.closeEmojiDrawer();
                this.closeGiphyDrawer();
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
            await this.giphySearch();
        },

        onGiphyInput: async function(ev) {
            const term = ev.currentTarget.value;
            await this.giphySearch(term);
        },

        giphySearch: async function(term) {
            const $input = this.$('.f-giphy input[name="giphy-search"]');
            $input.val(term || '');
            const $previews = this.$('.f-giphy .previews');
            this.$('.f-giphy').addClass('visible');
            requestAnimationFrame(() => $input.focus());
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
            this.refresh();
            if (altered) {
                this.selectEl(this.msgInput, {collapse: true});
            } else {
                this.captureSelection();
            }
            if (this.showCompleterSoon) {
                const type = this.showCompleterSoon;
                this.showCompleterSoon = false;
                await this.showCompleter(type);
            }
            if (this.completer) {
                const curWord = this.getCurrentWord();
                if (curWord && curWord.match(/^[@/]/)) {
                    this.completer.search(curWord);
                } else {
                    this.completer.remove();
                }
            }
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
            this.showCompleterSoon = false;
            const keyCode = ev.which || ev.keyCode;
            if (!this.editing && this.sendHistory.length && (keyCode === UP_KEY || keyCode === DOWN_KEY)) {
                const offt = this.sendHistoryOfft + (keyCode === UP_KEY ? 1 : -1);
                this.sendHistoryOfft = Math.min(Math.max(0, offt), this.sendHistory.length);
                if (this.sendHistoryOfft === 0) {
                    this.msgInput.innerHTML = '';
                    this.captureSelection();
                } else {
                    this.msgInput.innerHTML = this.sendHistory[this.sendHistory.length - this.sendHistoryOfft];
                    this.selectEl(this.msgInput);
                }
                this.refresh();  // No input event is triggered by our mutations here.
                return false;
            }
            const curWord = this.getCurrentWord();
            if (!curWord && !this.completer &&
                (ev.key === '@' || (ev.key === '/' && !this.msgInput.innerHTML))) {
                // Must wait until after `input` event processing to get proper
                // cursor selection info.
                this.showCompleterSoon = ev.key === '@' ? 'tag' : 'command';
            } else if (this.completer) {
                if (keyCode === ENTER_KEY || keyCode === TAB_KEY) {
                    const selected = this.completer.selected;
                    if (selected) {
                        if (this.completer._type === 'tag') {
                            this.tagSubstitute(selected);
                        } else {
                            this.commandSubstitute(selected);
                        }
                    } else {
                        this.completer.remove();
                    }
                } else if (keyCode === UP_KEY) {
                    this.completer.selectAdjust(-1);
                } else if (keyCode === DOWN_KEY) {
                    this.completer.selectAdjust(1);
                } else if (keyCode === ESC_KEY) {
                    this.completer.remove();
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

        showCompleter: async function(type) {
            const offset = this.getSelectionCoords();
            let horizKey = 'left';
            let horizVal = 0;
            if (offset && offset.x > this.$thread.width() / 2) {
                horizKey = 'right';
                horizVal = this.$thread.width() - offset.x;
            } else if (offset) {
                horizVal = offset.x - 12;
            }
            const View = type === 'tag' ? F.TagCompleterView : F.CommandCompleterView;
            const view = new View({model: this.model});
            view._type = type;
            view.$el.css({
                bottom: offset ? this.$thread.height() - offset.y : this.$el.height(),
                [horizKey]: horizVal
            });
            await view.render();
            if (this.completer) {
                this.completer.remove();
            } else {
                $('body').on('click', this.onClickAwayCompleter);
            }
            if (type === 'tag') {
                view.on('select', this.tagSubstitute.bind(this));
            } else {
                view.on('select', this.commandSubstitute.bind(this));
            }
            view.on('remove', () => this.completer = null);
            this.completer = view;
            this.$thread.append(view.$el);
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

        tagSubstitute: function(selected) {
            this.completer.remove();
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
            tagNode.innerHTML = selected.term;
            const padNode = document.createTextNode('\u00a0');
            const parentNode = wordMeta.node.parentNode;
            parentNode.replaceChild(afterNode, wordMeta.node);
            parentNode.insertBefore(padNode, afterNode);
            parentNode.insertBefore(tagNode, padNode);
            parentNode.insertBefore(beforeNode, tagNode);
            this.selectEl(padNode, {collapse: true});
        },

        commandSubstitute: function(selected) {
            this.completer.remove();
            this.msgInput.innerHTML = selected.term;
            this.selectEl(this.msgInput, {collapse: true});
        }
    });


    F.CompleterView = F.View.extend({
        template: 'views/completer.html',
        className: 'f-completer ui segment',

        events: {
            'click .entry': 'onEntryClick'
        },

        delegateEvents: function() {
            F.View.prototype.delegateEvents.apply(this, arguments);
            // NOTE: Must come after super call to repair implicit call to undelegate.
            $('body').on('click.clickAway' + this.cid, this.onClickAway.bind(this));
            return this;
        },

        undelegateEvents: function() {
            $('body').off('click.clickAway' + this.cid);
            return F.View.prototype.undelegateEvents.apply(this, arguments);
        },

        stopListening: function() {
            $('body').off('click.clickAway' + this.cid);
            return F.View.prototype.stopListening.apply(this, arguments);
        },

        remove: function() {
            this.trigger('remove', this);
            return F.View.prototype.remove.apply(this, arguments);
        },

        getTerms: async function() {
            /* Should return Array of terms (strings) */
            throw new Error("Virtual method not implemented");
        },

        getTerm: function(id) {
            return this.filtered.find(x => x.id === id);
        },

        render_attributes: async function() {
            const allTerms = await this.getTerms();
            if (this.searchTerm) {
                this.filtered = allTerms.filter(x => x.term.startsWith(this.searchTerm));
                // Validate the current selection by refinding it.
                this.selected = this.selected && this.filtered.find(x => x.id === this.selected.id);
            } else {
                this.filtered = allTerms;
            }
            if (!this.selected) {
                this.selected = this.filtered[0];
            }
            if (!this.filtered.length) {
                this.trigger('empty', this.searchTerm);
            }
            return {
                title: this.title,
                terms: this.filtered.map(x => Object.assign({
                    selected: this.selected.id === x.id
                }, x))
            };
        },

        search: async function(term) {
            this.searchTerm = term;
            await this.render();
            this.scrollSelectedIntoView();
        },

        selectAdjust: async function(offset) {
            const index = this.selected && this.filtered.findIndex(x => x.id === this.selected.id) || 0;
            const adjIndex = Math.max(0, Math.min(this.filtered.length - 1, index + offset));
            const newSelection = this.filtered[adjIndex];
            if (newSelection !== this.selected) {
                this.selected = newSelection;
                await this.render();
                this.scrollSelectedIntoView();
            }
        },

        scrollSelectedIntoView: function() {
            if (!this.selected) {
                return;
            }
            requestAnimationFrame(() => {
                const selectedEl = this.$(`.entry[data-id="${this.selected.id}"]`)[0];
                if (selectedEl) {
                    selectedEl.scrollIntoView({block: 'nearest'});
                }
            });
        },

        onClickAway: function(ev) {
            if (!$(ev.target).closest(this.$el).length) {
                this.remove();
            }
        },

        onEntryClick(ev) {
            //ev.preventDefault();  // Prevent loss of focus on input bar.
            this.trigger('select', this.getTerm(ev.currentTarget.dataset.id), this);
        }
    });


    F.TagCompleterView = F.CompleterView.extend({

        title: 'Tags',

        initialize: function() {
            this.distTags = this._getDistTags();
            this.on('empty', this.onEmpty);
            this.externalTags = [];
        },

        _getDistTags: async function() {
            const contacts = await this.model.getContacts();
            const ids = new Set(contacts.map(x => x.get('tag').id));
            const tags = contacts.map(x => ({
                id: x.get('tag').id,
                term: x.getTagSlug(),
                extra: '<i class="icon user"></i>'
            }));
            const dist = await this.model.getDistribution();
            // XXX Suboptimal discovery of tags until we have a proper
            // tag API for non-org tags. E.g. /v1/directory/tag/?id_in=...
            const distTagIds = [];
            for (const x of dist.includedTagids) {
                if (!ids.has(x)) {
                    distTagIds.push(x);
                }
            }
            if (distTagIds.length) {
                const raw = await F.atlas.resolveTagsBatchFromCache(distTagIds.map(x => `<${x}>`));
                for (const x of raw) {
                    tags.push({
                        id: x.includedTagids[0],
                        term: x.pretty,
                        extra: '<i class="icon tag"></i>'
                    });
                }
            }
            tags.push({
                id: 'special-all-tag',
                term: allMetaTag,
                title: 'Every member of this discussion',
                extra: '<i class="icon users"></i>'
            });
            return tags;
        },

        getTerms: async function() {
            const tags = await this.distTags;
            return tags.concat(this.externalTags);
        },

        onEmpty: function(searchTerm) {
            const contacts = F.foundation.getContacts().filter(x => x.getTagSlug());
            const externals = new Map(this.externalTags.map(x => [x.id, x]));
            for (const x of contacts) {
                if (!this.getTerm(x.id) && x.getTagSlug().startsWith(searchTerm)) {
                    externals.set(x.id, {
                        id: x.get('tag').id,
                        term: x.getTagSlug(),
                        extraClass: 'special',
                        title: 'Outside Contact',
                        extra: '<i class="icon user"></i>'
                    });
                }
            }
            const tags = F.foundation.getTags().filter(x => !x.get('user'));
            const unprefixedSearchTerm = searchTerm.substr(1);
            for (const x of tags) {
                if (!this.getTerm(x.id) && x.get('slug').startsWith(unprefixedSearchTerm)) {
                    externals.set(x.id, {
                        id: x.id,
                        title: 'Outside Tag',
                        term: '@' + x.get('slug'),
                        extraClass: 'special',
                        extra: '<i class="icon tag"></i>'
                    });
                }
            }
            if (externals.size !== this.externalTags.length) {
                this.externalTags = Array.from(externals.values());
                this.render();
            }
        }
    });


    F.CommandCompleterView = F.CompleterView.extend({

        title: 'Commands',

        getTerms: async function() {
            const commandFilters = inputFilters.filter(x =>
                !x.options.egg && x.hook.toString().startsWith('/^\\/'));
            return commandFilters.map(x => {
                const term = '/' + x.hook.toString().slice(4).split(/[^a-z0-9_-]/i)[0];
                return {
                    id: term,
                    term: term,
                    title: `Usage: ${x.options.usage}`,
                    extra: `<i class="icon ${x.options.icon}"></i>`
                };
            });
        }
    });
})();
