// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    const ENTER_KEY = 13;
    const UP_KEY = 38;
    const DOWN_KEY = 40;

    const inputFilters = [];

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
            this.sendHistory = []; // XXX get this seeded by the convo history.
            this.sendHistoryOfft = 0;
            this.editing = false;
            this.placeholderActive = true;
            this.updateGiphyPickerDebounced = _.debounce(this.updateGiphyPicker, 400);
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.fileInput = new F.FileInputView({
                el: this.$('.f-files')
            });
            this.$placeholder = this.$('.f-input .f-placeholder');
            this.$msgInput = this.$('.f-input .f-message');
            this.msgInput = this.$msgInput[0];
            this.$('.ui.dropdown').dropdown({
                direction: 'upward'
            });
            return this;
        },

        events: {
            'input .f-message': 'onComposeInput',
            'keydown .f-message': 'onComposeKeyDown',
            'click .f-send-action': 'onSendClick',
            'click .f-attach-action': 'onAttachClick',
            'click .f-giphy-action': 'onGiphyClick',
            'click .f-emoji-actiod': 'onEmojiClick',
            'focus .f-message': 'messageFocus',
            'click .f-placeholder': 'redirectPlaceholderFocus',
            'blur .f-message': 'messageBlur',
            'click .f-giphy .remove.icon': 'onCloseGiphyClick'
        },

        focusMessageField: function() {
            this.$msgInput.focus();
        },

        blurMessageField: function() {
            this.$msgInput.blur();
        },

        redirectPlaceholderFocus: function() {
            /* Placeholder text needs to never have focus. */
            this.focusMessageField();
        },

        messageFocus: function() {
            this.$('.f-input').addClass('focused');
        },

        messageBlur: function() {
            this.$('.f-input').removeClass('focused');
        },

        onSendClick: function(ev) {
            this.send();
            ev.preventDefault();
            ev.stopPropagation();
        },

        onCloseGiphyClick: function() {
            this.$('.f-giphy').removeClass('visible');
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
                this.sendHistory.push(raw);
            }
            this.resetInputField();
        },

        resetInputField: function(histItem, noFocus) {
            if (histItem) {
                this.sendHistory.push(histItem);
            }
            this.fileInput.removeFiles();
            this.msgInput.innerHTML = "";
            this.sendHistoryOfft = 0;
            this.editing = false;
            this.togglePlaceholder(/*show*/ true);
            if (!noFocus) {
                this.focusMessageField();
            }
        },

        togglePlaceholder: function(show) {
            /* Optimize placeholder toggle to avoid repainting */
            if (!show === !this.placeholderActive) {
                return;
            }
            this.placeholderActive = !!show;
            this.$placeholder.toggle(show);
        },

        setLoading: function(loading) {
            const btn = this.$('.f-send');
            btn[`${loading ? 'add' : 'remove'}Class`]('loading circle notched');
        },

        onAttachClick: function() {
            this.fileInput.openFileChooser();
        },

        onEmojiClick: async function() {
            const emojiPicker = new F.EmojiPicker();
            emojiPicker.on('select', x => {
                debugger;
            });
            await emojiPicker.render();
            this.$('.f-emoji-picker-holder').append(emojiPicker.$el);
            this.$('.f-giphy').removeClass('visible');
            this.$('.f-emoji').addClass('visible');
        },

        onGiphyClick: async function() {
            const term = F.emoji.colons_to_unicode(this.msgInput.innerText.trim());
            await this.updateGiphyPicker(term);
        },

        updateGiphyPicker: async function(term) {
            let choices = await F.easter.giphy('PG-13', term, /*limit*/ 15);
            if (!choices.length) {
                choices = await F.easter.giphy('PG', 'file not found', /*limit*/ 15);
            }
            const $previews = this.$('.f-giphy .previews');
            $previews.empty();
            const views = await Promise.all(choices.map(
                giphy => (new F.GiphyThumbnailView({composeView: this, giphy, term})).render()));
            for (const x of views) {
                $previews.append(x.$el);
            }
            this.$('.f-emoji').removeClass('visible');
            this.$('.f-giphy').addClass('visible');
        },

        onComposeInput: function(e) {
            this.editing = true;
            const dirty = this.msgInput.innerHTML;
            const clean = F.util.htmlSanitize(dirty);
            if (clean !== dirty) {
                console.warn("Sanitizing input to:", clean);
                this.msgInput.innerHTML = clean;
                this.selectEl(this.msgInput, /*tail*/ true);
            }
            const pure = F.emoji.colons_to_unicode(clean);
            if (pure !== clean) {
                this.msgInput.innerHTML = pure;
                this.selectEl(this.msgInput, /*tail*/ true);
            }
            this.togglePlaceholder(!pure);
            if (this.$('.f-giphy').hasClass('visible')) {
                this.updateGiphyPickerDebounced(F.emoji.colons_to_unicode(this.msgInput.innerText.trim()));
            }
        },

        selectEl: function(el, tail) {
            const range = document.createRange();
            range.selectNodeContents(el);
            if (tail) {
                range.collapse(false);
            }
            const selection = getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        },

        onComposeKeyDown: function(e) {
            const keyCode = e.which || e.keyCode;
            if (!this.editing && this.sendHistory.length && (keyCode === UP_KEY || keyCode === DOWN_KEY)) {
                const offt = this.sendHistoryOfft + (keyCode === UP_KEY ? 1 : -1);
                this.sendHistoryOfft = Math.min(Math.max(0, offt), this.sendHistory.length);
                if (this.sendHistoryOfft === 0) {
                    this.msgInput.innerHTML = '';
                } else {
                    this.msgInput.innerHTML = this.sendHistory[this.sendHistory.length - this.sendHistoryOfft];
                    this.selectEl(this.msgInput);
                }
                return false;
            } else if (keyCode === ENTER_KEY && !(e.altKey||e.shiftKey||e.ctrlKey)) {
                if (this.msgInput.innerText.split(/```/g).length % 2) {
                    // Normal enter pressed and we are not in literal mode.
                    this.send();
                    return false; // prevent delegation
                }
            } 
        }
    });
})();
