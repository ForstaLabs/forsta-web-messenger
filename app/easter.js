/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};
    F.easter = {};

    F.easter.registerSingle = async function(phone) {
        phone = phone.toString().replace(/[.-\s]/g, '');
        const buf = [];
        if (!phone.startsWith('+')) {
            buf.push('+');
        }
        if (!phone.startsWith('1')) {
            buf.push('1');
        }
        buf.push(phone);
        phone = buf.join('');

        const am = await F.foundation.getAccountManager();
        am.requestSMSVerification(phone);
        const $el = $('<div class="ui modal"><div class="ui segment">' +
                      '<div class="ui input action">' +
                      '<input type="text" placeholder="Verification Code..."/>' +
                      '<button class="ui button">Register</button>' +
                      '</div></div></div>');
        $el.on('click', 'button', async function() {
            const code = $el.find('input').val().replace(/[\s-]/g, '');
            await am.registerSingleDevice(phone, code);
            $el.modal('hide');
        });
        $('body').append($el);
        $el.modal('setting', 'closable', false).modal('show');
    };


    async function saneIdb(req) {
        const p = new Promise((resolve, reject) => {
            req.onsuccess = ev => resolve(ev.target.result);
            req.onerror = ev => reject(new Error(ev.target.errorCode));
        });
        return await p;
    }

    F.easter.wipeConversations = async function() {
        const db = await saneIdb(indexedDB.open(F.Database.id));
        const t = db.transaction(db.objectStoreNames, 'readwrite');
        const conversations = t.objectStore('conversations');
        const messages = t.objectStore('messages');
        const groups = t.objectStore('groups');
        await saneIdb(messages.clear());
        await saneIdb(groups.clear());
        await saneIdb(conversations.clear());
        location.replace('.');
    };

    if (F.addComposeInputFilter) {
        F.addComposeInputFilter(/^\/pat[-_]?factor\b/i, function() {
            return '<img src="/@static/images/tos3.gif"></img>';
        }, {egg: true});

        F.addComposeInputFilter(/^\/register\s+(.*)/i, function(phone) {
            F.easter.registerSingle(phone);
            return `<pre>Starting registration for: ${phone}`;
        }, {egg: true, clientOnly: true});

        F.addComposeInputFilter(/^\/wipe/i, async function() {
            await F.easter.wipeConversations();
            return false;
        }, {
            icon: 'erase',
            usage: '/wipe',
            about: 'Wipe out <b>ALL</b> conversations.'
        });

        F.addComposeInputFilter(/^\/rename\s+(.*)/i, async function(name) {
            if (this.isPrivate()) {
                return '<i class="icon warning sign red"></i><b>Only groups can be renamed.</b>';
            }
            await this.modifyGroup({name});
            return false;
        }, {
            icon: 'quote left',
            clientOnly: true,
            usage: '/rename NEW_CONVO_NAME...',
            about: 'Change the name of the current conversation group.'
        });

        F.addComposeInputFilter(/^\/leave\b/i, async function() {
            await this.leaveGroup();
            this.destroy();
            return false;
        }, {
            icon: 'eject',
            usage: '/leave',
            about: 'Leave this conversation.'
        });

        F.addComposeInputFilter(/^\/clear\b/i, function() {
            this.messageCollection.reset([]);
            return false;
        }, {
            icon: 'recycle',
            usage: '/clear',
            about: 'Clear your message history for this conversation. '+
                   '<i>Other people are not affected.</i>'
        });

        F.addComposeInputFilter(/^\/version\b/i, function() {
            return `<a href="https://github.com/ForstaLabs/relay-web-app/${forsta_env.GIT_COMMIT}">` +
                   `GIT Commit: ${forsta_env.GIT_COMMIT}</a>`;
        }, {
            icon: 'git',
            usage: '/version',
            about: 'Show the current version/revision of this web app.',
            clientOnly: true
        });

        F.addComposeInputFilter(/^\/lenny\b/i, function() {
            return '( ͡° ͜ʖ ͡°)';
        }, {
            icon: 'smile',
            usage: '/lenny',
            about: 'Send a friendly ascii Lenny.'
        });

        F.addComposeInputFilter(/^\/donger\b/i, function() {
            return '༼ つ ◕_◕ ༽つ';
        }, {
            icon: 'smile',
            usage: '/donger',
            about: 'Send a friendly ascii Donger.'
        });

        F.addComposeInputFilter(/^\/shrug\b/i, function() {
            return '¯\\_(ツ)_/¯';
        }, {
            icon: 'smile',
            usage: '/shrug',
            about: 'Send a friendly ascii Shrug.'
        });

        F.addComposeInputFilter(/^\/help\b/i, function() {
            const commands = [];
            for (const x of F.getComposeInputFilters()) {
                const xx = x.options;
                if (xx.egg || !xx.usage) {
                    continue;
                }
                const about = [
                    `<h6 class="ui header">`,
                        `<i class="icon ${xx.icon || "send"}"></i>`,
                        `<div class="content">`,
                            xx.usage,
                            `<div class="sub header">${xx.about || ''}</div>`,
                        '</div>',
                    '</h6>',
                ];
                commands.push(about.join(''));
            }
            return commands.join('<div class="ui divider"></div>');
        }, {
            usage: '/help',
            about: 'Display info about input commands.',
            clientOnly: true
        });
    }
})();
