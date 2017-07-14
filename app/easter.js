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
    };

    if (F.addComposeInputFilter) {
        F.addComposeInputFilter(/^\/pat[-_]?factor\b/i, function() {
            return "<img src='/@static/images/tos3.gif'></img>";
        });

        F.addComposeInputFilter(/^\/register\s+(.*)/i, function(phone) {
            F.easter.registerSingle(phone);
            return `<pre>Starting registration for: ${phone}`;
        });

        F.addComposeInputFilter(/^\/wipe/i, function() {
            F.easter.wipeConversations();
            return '<pre>Wiping conversations</pre>';
        });

        F.addComposeInputFilter(/^\/rename\s+(.*)/i, function(name) {
            this.modifyGroup({name});
        });

        F.addComposeInputFilter(/^\/leave\b/i, function() {
            this.leaveGroup();
        });

        F.addComposeInputFilter(/^\/destroy\b/i, function() {
            this.leaveGroup();
            this.destroy();
        });

        F.addComposeInputFilter(/^\/clear\b/i, function() {
            this.messageCollection.reset([]);
        });

        F.addComposeInputFilter(/^\/version\b/i, function() {
            return `<a href="https://github.com/ForstaLabs/relay-web-app//${forsta_env.GIT_COMMIT}">` +
                   `Git Commit: ${forsta_env.GIT_COMMIT}</a>`;
        });
    }

})();
