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
        },

        render: async function() {
            await F.View.prototype.render.call(this);
            this.fileInput = new F.FileInputView({
                el: this.$('.f-files')
            });
            this.$messageField = this.$('.f-message');
            this.$('.ui.dropdown').dropdown();
            return this;
        },

        events: {
            'input .f-message': 'onComposeInput',
            'keydown .f-message': 'onComposeKeyDown',
            'click .f-send': 'onSendClick',
            'click .f-attach': 'onAttachClick',
            'focus .f-message': 'messageFocus',
            'blur .f-message': 'messageBlur'
        },

        focusMessageField: function() {
            this.$messageField.focus();
        },

        messageFocus: function(ev) {
            this.$('.f-input').addClass('focused');
        },

        messageBlur: function(ev) {
            this.$('.f-input').removeClass('focused');
        },

        onSendClick: function(ev) {
            this.send();
            ev.preventDefault();
            ev.stopPropagation();
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
            const el = this.$messageField[0];
            const raw = el.innerHTML;
            const plain = F.emoji.colons_to_unicode(el.innerText.trim());
            const processed = await this.processInputFilters(plain);
            let safe_html;
            if (processed) {
                if (processed.nosend) {
                    this.resetInputField(raw);
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

        resetInputField: function(histItem) {
            if (histItem) {
                this.sendHistory.push(histItem);
            }
            this.fileInput.removeFiles();
            this.$messageField[0].innerHTML = "";
            this.sendHistoryOfft = 0;
            this.editing = false;
            this.focusMessageField();
        },

        setLoading: function(loading) {
            const btn = this.$('.f-send');
            btn[`${loading ? 'add' : 'remove'}Class`]('loading circle notched');
        },

        onAttachClick: function(e) {
            this.fileInput.openFileChooser();
        },

        onComposeInput: function(e) {
            this.editing = true;
            const msgdiv = e.currentTarget;
            const dirty = msgdiv.innerHTML;
            const clean = F.util.htmlSanitize(dirty);
            if (clean !== dirty) {
                console.warn("Sanitizing input to:", clean);
                msgdiv.innerHTML = clean;
                this.selectEl(msgdiv, /*tail*/ true);
            }
            const pure = F.emoji.colons_to_unicode(clean);
            if (pure !== clean) {
                msgdiv.innerHTML = pure;
                this.selectEl(msgdiv, /*tail*/ true);
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
            const msgdiv = e.currentTarget;
            if (!this.editing && this.sendHistory.length && (keyCode === UP_KEY || keyCode === DOWN_KEY)) {
                const offt = this.sendHistoryOfft + (keyCode === UP_KEY ? 1 : -1);
                this.sendHistoryOfft = Math.min(Math.max(0, offt), this.sendHistory.length);
                if (this.sendHistoryOfft === 0) {
                    msgdiv.innerHTML = '';
                } else {
                    msgdiv.innerHTML = this.sendHistory[this.sendHistory.length - this.sendHistoryOfft];
                    this.selectEl(msgdiv);
                }
                return false;
            } else if (keyCode === ENTER_KEY && !(e.altKey||e.shiftKey||e.ctrlKey)) {
                if (msgdiv.innerText.split(/```/g).length % 2) {
                    // Normal enter pressed and we are not in literal mode.
                    this.send();
                    return false; // prevent delegation
                }
            }
        }
    });
})();
