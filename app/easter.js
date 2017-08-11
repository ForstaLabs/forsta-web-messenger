/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.easter = {};

    const GIPHY_KEY = 'a1c3af2e4fc245ca9a6c0055be4963bb';

    ns.registerAccount = async function() {
        if (await F.util.confirmModal({
            header: 'Confirm account creation / replacement',
            content: 'This action will purge any existing devices in this account.'
        })) {
            const am = await F.foundation.getAccountManager();
            await am.registerAccount(F.currentUser.id, 'EASTER');
            await F.util.sleep(1);
            location.replace(F.urls.main);
        }
    };

    async function saneIdb(req) {
        const p = new Promise((resolve, reject) => {
            req.onsuccess = ev => resolve(ev.target.result);
            req.onerror = ev => reject(new Error(ev.target.errorCode));
        });
        return await p;
    }

    function safejson(value){
        const json = JSON.stringify(value);
        return $('<div/>').text(json).html();
    }

    ns.wipeConversations = async function() {
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
        }, {
            egg: true,
            usage: '/patfactor',
            about: 'Display Forsta <q>Terms of Service</q>'
        });

        F.addComposeInputFilter(/^\/register\b/i, function() {
            ns.registerAccount();
            return `Starting account registration for: ${F.currentUser.id}`;
        }, {
            egg: true,
            clientOnly: true,
            usage: '/register',
            about: 'Perform account registration (DANGEROUS)'
        });

        F.addComposeInputFilter(/^\/sync\b/i, async function() {
            await F.foundation.fetchData(/*syncGroups*/ true);
            return 'Sync Complete';
        }, {
            egg: true,
            clientOnly: true,
            usage: '/sync',
            about: 'Refresh users, tags and request group sync from your other devices.'
        });

        F.addComposeInputFilter(/^\/wipe/i, async function() {
            await ns.wipeConversations();
            return false;
        }, {
            egg: true,
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
            if (this.isPrivate()) {
                return '<i class="icon warning sign red"></i><b>Only groups can be left.</b>';
            }
            await this.leaveGroup();
            return false;
        }, {
            clientOnly: true,
            icon: 'eject',
            usage: '/leave',
            about: 'Leave this conversation.'
        });

        F.addComposeInputFilter(/^\/close\b/i, async function() {
            if (this.get('type') === 'group' && !this.get('left')) {
                await this.leaveGroup(/*close*/ true);
            }
            await this.destroyMessages();
            await this.destroy();
            return false;
        }, {
            clientOnly: true,
            icon: 'window close',
            usage: '/close',
            about: 'Close this conversation forever.'
        });

        F.addComposeInputFilter(/^\/clear\b/i, async function() {
            await this.destroyMessages();
            return false;
        }, {
            icon: 'recycle',
            clientOnly: true,
            usage: '/clear',
            about: 'Clear your message history for this conversation. '+
                   '<i>Other people are not affected.</i>'
        });

        F.addComposeInputFilter(/^\/cdump\b/i, async function() {
            const props = Object.keys(this.attributes).sort().map(key =>
                `<tr><td nowrap><b>${key}:</b></td><td>${safejson(this.get(key))}</td></tr>`);
            return `Conversation details...<table>${props.join('')}</table>`;
        }, {
            egg: true,
            clientOnly: true,
            icon: 'lab',
            usage: '/cdump',
            about: 'Show details about this conversation.'
        });

        F.addComposeInputFilter(/^\/mdump(?:\s+|$)(.*)/i, async function(index) {
            index = index || 0;
            if (index < 0) {
                return '<i class="icon warning sign red"></i><b>Use a positive index.</b>';
            }
            const message = this.messages.at(index);
            if (!message) {
                return `<i class="icon warning sign red"></i><b>No message found at index: ${index}</b>`;
            }
            const props = Object.keys(message.attributes).sort().map(key =>
                `<tr><td nowrap>${key}:</td><td>${safejson(message.get(key))}</td></tr>`);
            const outbuf = [];
            outbuf.push(`Message details...<table>${props.join('')}</table>`);
            outbuf.push(`<hr/>Receipts...`);
            for (const receipt of message.receipts.models) {
                const props = Object.keys(receipt.attributes).sort().map(key =>
                    `<tr><td nowrap>${key}:</td><td>${safejson(receipt.get(key))}</td></tr>`);
                outbuf.push(`<table>${props.join('')}</table>`);
            }
            return outbuf.join('\n');
        }, {
            egg: true,
            clientOnly: true,
            icon: 'lab',
            usage: '/mdump [INDEX]',
            about: 'Show details about a recent message.'
        });

        F.addComposeInputFilter(/^\/version\b/i, function() {
            return `<a href="https://github.com/ForstaLabs/relay-web-app/tree/${forsta_env.GIT_COMMIT}">` +
                   `GIT Commit: ${forsta_env.GIT_COMMIT}</a>`;
        }, {
            egg: true,
            icon: 'git',
            usage: '/version',
            about: 'Show the current version/revision of this web app.',
            clientOnly: true
        });

        F.addComposeInputFilter(/^\/lenny\b/i, function() {
            return '( ͡° ͜ʖ ͡°)';
        }, {
            egg: true,
            icon: 'smile',
            usage: '/lenny',
            about: 'Send a friendly ascii Lenny.'
        });

        F.addComposeInputFilter(/^\/donger\b/i, function() {
            return '༼ つ ◕_◕ ༽つ';
        }, {
            egg: true,
            icon: 'smile',
            usage: '/donger',
            about: 'Send a friendly ascii Donger.'
        });

        F.addComposeInputFilter(/^\/shrug\b/i, function() {
            return '¯\\_(ツ)_/¯';
        }, {
            egg: true,
            icon: 'smile',
            usage: '/shrug',
            about: 'Send a friendly ascii Shrug.'
        });

        F.addComposeInputFilter(/^\/giphy(?:\s+|$)(.*)/i, async function(tag) {
            let rating = 'PG';
            if (tag.startsWith('-r ')) {
                rating = 'R';
                tag = tag.substring(3);
            }
            const qs = F.util.urlQuery({
                api_key: GIPHY_KEY,
                tag,
                rating
            });
            const result = await fetch('https://api.giphy.com/v1/gifs/random' + qs);
            if (!result.ok) {
                console.error('Giphy fetch error:', await result.text());
                return '<i class="icon warning sign red"></i>' +
                       `Ooops, failed to get giphy for: <b>${tag}</b>`;
            }
            const info = await result.json();
            return `<video autoplay loop><source src="${info.data.image_mp4_url}"/></video>` +
                   `<p><q>${tag}</q></p>`;
        }, {
            icon: 'image',
            usage: '/giphy TAG...',
            about: 'Send a random animated GIF from https://giphy.com.'
        });

        F.addComposeInputFilter(/^\/help(?:\s+|$)(--eggs)?/i, function(eggs) {
            const show_eggs = !!eggs;
            const commands = [];
            const filters = F.getComposeInputFilters().map(x => x.options);
            filters.sort((a, b) => a.usage < b.usage ? -1 : 1);
            for (const x of filters) {
                if ((x.egg && !show_eggs) || !x.usage) {
                    continue;
                }
                const about = [
                    `<h6 class="ui header">`,
                        `<i class="icon ${x.icon || "send"}"></i>`,
                        `<div class="content">`,
                            x.usage,
                            `<div class="sub header">${x.about || ''}</div>`,
                        '</div>',
                    '</h6>',
                ];
                commands.push(about.join(''));
            }
            return commands.join('<br/>');
        }, {
            usage: '/help',
            about: 'Display info about input commands.',
            clientOnly: true
        });

        F.addComposeInputFilter(/^\/markup\b/i, function() {
            const descriptions = [
                [`You Type:`, `You See:`],
                [`" \`sample output\` "`, `<samp>sample output</samp>`],
                [`"!blinking text!"`, `<blink>blinking text</blink>`],
                [`"==highlighter=="`,`<mark>highlighter</mark>`],
                [`"~~strikethrough~~"`,`<del>strikethrough</del>`],
                [`"__underline__"`,`<u>underline</u>`],
                [`"text^super^"`,`text<sup>super</sup>`],
                [`"text?subscript?"`,`text<sub>subscript</sub>`],
                [`"_emphasis_"`,`<em>emphasis</em>`],
                [`"*strong text*"`,`<strong>strong text</strong>`],
                [`"# Big Text #"`,`<h5>Big Text</h5>`],
                [`"## Bigger Text ##"`,`<h3>Bigger Text</h3>`],
                [`"### Biggest Text ###"`,`<h1>Biggest Text</h1>`]
            ];

            const output = descriptions.map(x => `<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join('\n');
            return `Markup Syntax: <table>${output}</table>`;
        }, {
            icon: 'lab',
            usage: '/markup',
            about: 'Display information pertaining to rich-text markup syntax.',
            clientOnly: true
        });
    }
})();
