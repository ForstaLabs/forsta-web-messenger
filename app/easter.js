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
            F.util.promptModal({
                header: 'Registering...',
                icon: 'loading notched circle',
                content: 'Allow a few seconds for registration to complete.',
                footer: 'Your browser will refresh when complete.'
            });
            const am = await F.foundation.getAccountManager();
            await am.registerAccount(F.currentUser.id, F.product);
            await F.util.sleep(0.200);
            location.assign(F.urls.main);
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

    async function giphy(rating, tag, command) {
        const qs = F.util.urlQuery({
            api_key: GIPHY_KEY,
            tag,
            rating
        });
        const result = await fetch('https://api.giphy.com/v1/gifs/random' + qs);
        if (!result.ok) {
            throw new Error('Giphy fetch error: ' + await result.text());
        }
        const info = await result.json();
        if (!info.data.image_mp4_url) {
            throw new Error(`No giphys found for: <q>${tag}</q>`);
        }
        return `<video autoplay loop><source src="${info.data.image_mp4_url}"/></video>` +
               `<p class="giphy"><q>${command} ${tag}</q></p>`;
    }

    ns.wipeStores = async function(stores) {
        const db = await saneIdb(indexedDB.open(F.Database.id));
        const t = db.transaction(db.objectStoreNames, 'readwrite');
        async function clearStore(name) {
            let store;
            try {
                store = t.objectStore(name);
            } catch(e) {
                console.warn(e);
                return;
            }
            await saneIdb(store.clear());
        }
        await Promise.all(stores.map(clearStore));
        await clearStore('messages');
        await clearStore('threads');
        await clearStore('receipts');
        await clearStore('cache');
        location.replace('.');
    };

    ns.wipeConversations = async function() {
        await ns.wipeStores([
            'messages',
            'threads',
            'receipts',
            'cache'
        ]);
        location.replace('.');
    };

    ns.uninstall = async function() {
        await ns.wipeStores([
            'messages',
            'threads',
            'receipts',
            'cache',
            'state',
            'signedPreKeys',
            'preKeys',
            'identityKeys',
            'sessions'
        ]);
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
            icon: 'call',
            usage: '/register',
            about: 'Perform account registration <b>[USE CAUTION]</b>'
        });

        F.addComposeInputFilter(/^\/wipe\b/i, async function() {
            await ns.wipeConversations();
            return false;
        }, {
            egg: true,
            clientOnly: true,
            icon: 'erase',
            usage: '/wipe',
            about: 'Wipe out <b>ALL</b> conversations'
        });

        F.addComposeInputFilter(/^\/uninstall\b/i, async function() {
            await ns.uninstall();
            return false;
        }, {
            egg: true,
            clientOnly: true,
            icon: 'bomb',
            usage: '/uninstall',
            about: 'Uninstall app from browser <b>[USE CAUTION]</b>'
        });

        F.addComposeInputFilter(/^\/flush\b/i, async function() {
            await F.cache.flushAll();
            return 'Flushed Caches';
        }, {
            egg: true,
            clientOnly: true,
            icon: 'recycle',
            usage: '/flush',
            about: 'Flush internal caches'
        });

        F.addComposeInputFilter(/^\/rename\s+(.*)/i, async function(title) {
            await this.save('title', title);
        }, {
            icon: 'quote left',
            usage: '/rename NEW NAME...',
            about: 'Change the name of the current thread'
        });

        F.addComposeInputFilter(/^\/set\s+([^\s]+)\s+(.*)/i, async function(key, json) {
            await this.save(key, JSON.parse(json));
        }, {
            egg: true,
            icon: 'edit',
            usage: '/set KEY JSON...',
            about: 'Change an attribute on this thread'
        });

        F.addComposeInputFilter(/^\/leave\b/i, async function() {
            await this.leaveThread();
            return false;
        }, {
            clientOnly: true,
            icon: 'eject',
            usage: '/leave',
            about: 'Leave this thread'
        });

        F.addComposeInputFilter(/^\/close\b/i, async function() {
            if (!this.get('left')) {
                await this.leaveThread(/*close*/ true);
            }
            await this.destroyMessages();
            await this.destroy();
            return false;
        }, {
            clientOnly: true,
            icon: 'window close',
            usage: '/close',
            about: 'Close this thread forever'
        });

        F.addComposeInputFilter(/^\/clear\b/i, async function() {
            await this.destroyMessages();
            return false;
        }, {
            icon: 'recycle',
            clientOnly: true,
            usage: '/clear',
            about: 'Clear your message history for this thread ' +
                   '(<i>Other people are not affected.</i>)'
        });

        F.addComposeInputFilter(/^\/tdump\b/i, async function() {
            const props = Object.keys(this.attributes).sort().map(key =>
                `<tr><td nowrap><b>${key}:</b></td><td>${safejson(this.get(key))}</td></tr>`);
            return `Thread details...<table>${props.join('')}</table>`;
        }, {
            egg: true,
            clientOnly: true,
            icon: 'list',
            usage: '/tdump',
            about: 'Show details about this thread'
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
            icon: 'list',
            usage: '/mdump [INDEX]',
            about: 'Show details about a recent message'
        });

        F.addComposeInputFilter(/^\/version\b/i, function() {
            return `<a href="https://github.com/ForstaLabs/relay-web-app/tree/${forsta_env.GIT_COMMIT}">` +
                   `GIT Commit: ${forsta_env.GIT_COMMIT}</a>`;
        }, {
            egg: true,
            icon: 'git',
            usage: '/version',
            about: 'Show the current version/revision of this web app',
            clientOnly: true
        });

        F.addComposeInputFilter(/^\/lenny\b/i, function() {
            return '( ͡° ͜ʖ ͡°)';
        }, {
            egg: true,
            icon: 'smile',
            usage: '/lenny',
            about: 'Send a friendly ascii "Lenny"'
        });

        F.addComposeInputFilter(/^\/donger\b/i, function() {
            return '༼ つ ◕_◕ ༽つ';
        }, {
            egg: true,
            icon: 'smile',
            usage: '/donger',
            about: 'Send a friendly ascii "Donger"'
        });

        F.addComposeInputFilter(/^\/shrug\b/i, function() {
            return '¯\\_(ツ)_/¯';
        }, {
            egg: true,
            icon: 'smile',
            usage: '/shrug',
            about: 'Send a friendly ascii "Shrug"'
        });

        F.addComposeInputFilter(/^\/nsfwgiphy(?:\s+|$)(.*)/i, async function(tag) {
            return await giphy('R', tag, '/nsfwgiphy');
        }, {
            egg: true,
            icon: 'image',
            usage: '/nsfwgiphy TAG...',
            about: 'Send a random animated GIF from https://giphy.com'
        });

        F.addComposeInputFilter(/^\/giphy(?:\s+|$)(.*)/i, async function(tag) {
            return await giphy('PG', tag, '/giphy');
        }, {
            icon: 'image',
            usage: '/giphy TAG...',
            about: 'Send a random animated GIF from https://giphy.com'
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
                        `<i class="icon ${x.icon || "question"} ${x.egg && "red"}"></i>`,
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
            icon: 'question',
            about: 'Display info about input commands',
            clientOnly: true
        });

        F.addComposeInputFilter(/^\/markdown\b/i, function() {
            const descriptions = [
                [`You Type:`, `You See:`],
                [` \`pre  formatted\` `, `<samp>pre  formatted</samp>`],
                [`!blinking!`, `<blink>blinking</blink>`],
                [`==highlight==`,`<mark>highlight</mark>`],
                [`~~strike~~`,`<del>strike</del>`],
                [`__underline__`,`<u>underline</u>`],
                [`^super^`,`<sup>super</sup>`],
                [`?subscript?`,`<sub>subscript</sub>`],
                [`_italic`,`<em>italic</em>`],
                [`*strong*`,`<strong>strong</strong>`],
                [`# Big #`,`<h5>Big</h5>`],
                [`## Bigger ##`,`<h3>Bigger</h3>`],
                [`### Biggest ###`,`<h1>Biggest</h1>`]
            ];
            const output = descriptions.map(x => `<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join('\n');
            return `Markdown Syntax: <table>${output}</table>`;
        }, {
            icon: 'paragraph',
            usage: '/markdown',
            about: 'Display information pertaining to rich-text markdown syntax.',
            clientOnly: true
        });

        F.addComposeInputFilter(/^\/join\s+(.*)/i, async function(expression) {
            const thread = await F.foundation.getThreads().ensure(expression);
            F.mainView.openThread(thread);
        }, {
            icon: 'talk',
            clientOnly: true,
            usage: '/join TAG EXPRESSIONS...',
            about: 'Join or create a new thread'
        });

        F.addComposeInputFilter(/^\/add\s+(.*)/i, async function(expression) {
            const dist = this.get('distribution');
            const adds = F.ccsm.sanitizeTags(expression);
            const updated = await F.ccsm.resolveTags(`(${dist}) + (${adds})`);
            if (!updated.universal) {
                throw new Error("Invalid expression");
            }
            this.save({distribution: updated.universal});
        }, {
            icon: 'add user',
            usage: '/add TAG EXPRESSION...',
            about: 'Add users and/or tags to this thread ' +
                   '(E.g <i style="font-family: monospace">"/add @jim + @sales"</i>)'
        });

        F.addComposeInputFilter(/^\/remove\s+(.*)/i, async function(expression) {
            const dist = this.get('distribution');
            const removes = F.ccsm.sanitizeTags(expression);
            const updated = await F.ccsm.resolveTags(`(${dist}) - (${removes})`);
            if (!updated.universal) {
                throw new Error("Invalid expression");
            }
            this.save({distribution: updated.universal});
        }, {
            icon: 'remove user',
            usage: '/remove TAG EXPRESSION...',
            about: 'Remove users and/or tags from this thread ' +
                   '(E.g. <i style="font-family: monospace">"/remove @mitch.hed:acme @doug.stanhope"</i>)'
        });

        F.addComposeInputFilter(/^\/members\b/i, async function() {
            const details = await F.ccsm.resolveTags(this.get('distribution'));
            const users = await F.ccsm.userDirectoryLookup(details.userids);
            if (!users.length) {
                return '<i class="icon warning sign red"></i><b>No members in this thread</b>';
            }
            const outbuf = ['<div class="member-list">'];
            for (const x of users) {
                outbuf.push([
                    '<div class="member-row">',
                        '<div class="member-avatar">',
                            `<img class="f-avatar ui avatar image" src="${(await x.getAvatar()).url}"/>`,
                        '</div>',
                        '<div class="member-info">',
                            `<a class="name" data-user-popup="${x.id}">${x.getName()}</a>`,
                            `<div class="slug">@${await x.getFQSlug()}</div>`,
                        '</div>',
                    '</div>',
                ].join(''));
            }
            outbuf.push('</div>');
            return outbuf.join('');
        }, {
            icon: 'address book',
            clientOnly: true,
            usage: '/members',
            about: 'Show the current members of this thread'
        });
    }
})();
