// vim: ts=4:sw=4:expandtab
/* global relay */

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
            const name = F.foundation.generateDeviceName();
            await am.registerAccount(name);
            await relay.util.sleep(0.200);
            location.assign(F.urls.main);
            await relay.util.never();
        }
    };

    function safejson(value){
        const json = JSON.stringify(value);
        return $('<div/>').text(json).html();
    }

    ns.giphy = async function(rating, q, limit) {
        const qs = F.util.urlQuery({
            api_key: GIPHY_KEY,
            q,
            rating,
            limit
        });
        const results = await fetch('https://api.giphy.com/v1/gifs/search' + qs);
        const info = await results.json();
        return info.data;
    };

    ns.wipeStores = async function(stores) {
        const db = await F.util.idbRequest(indexedDB.open(F.Database.id));
        stores = stores || Array.from(db.objectStoreNames);
        const t = db.transaction(stores, 'readwrite');
        async function clearStore(name) {
            let store;
            try {
                store = t.objectStore(name);
            } catch(e) {
                console.warn(e);
                return;
            }
            await F.util.idbRequest(store.clear());
        }
        await Promise.all(stores.map(clearStore));
    };

    ns.wipeContent = async function() {
        await ns.wipeStores([
            'messages',
            'threads',
            'contacts',
            'receipts',
            'protocolReceipts',
        ]);
        await F.state.remove('lastSync');
        await F.state.put('unreadCount', 0);
        await F.cache.flushAll();
        location.reload();
        await relay.util.never();
    };

    ns.uninstall = async function() {
        await ns.wipeStores();
        await F.cache.flushAll();
        location.reload(/*nocache*/ true);
        await relay.util.never();
    };

    if (F.addComposeInputFilter) {
        F.addComposeInputFilter(/^\/register\b/i, function() {
            const name = F.foundation.generateDeviceName();
            ns.registerAccount(name);
            return `Starting account registration for: ${F.currentUser.id}`;
        }, {
            egg: true,
            clientOnly: true,
            icon: 'call',
            usage: '/register',
            about: 'Perform account registration <b>[USE CAUTION]</b>'
        });

        F.addComposeInputFilter(/^\/wipe\b/i, async function() {
            await ns.wipeContent();
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
            icon: 'trash',
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
            usage: '/rename NEW_NAME...',
            about: 'Change the name of the current thread'
        });

        F.addComposeInputFilter(/^\/tset\s+([^\s]+)\s+(.*)/i, async function(key, json) {
            const oldValue = this.get(key);
            const value = json === 'undefined' ? undefined : JSON.parse(json);
            await this.save(key, value);
            return `<b>/tset ${key} ${json}</b><code>Previous Value: ${F.tpl.help.dump(oldValue)}</code>`;
        }, {
            egg: true,
            clientOnly: true,
            icon: 'edit',
            usage: '/tset KEY JSON_VALUE...',
            about: 'Change an attribute of this thread'
        });

        F.addComposeInputFilter(/^\/tget\s+([^\s]+)/i, function(key) {
            return `<b>/tget ${key}</b><code>${F.tpl.help.dump(this.get(key))}</code>`;
        }, {
            egg: true,
            clientOnly: true,
            icon: 'file',
            usage: '/tget KEY',
            about: 'Display an attribute of this thread'
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

        F.addComposeInputFilter(/^\/archive\b/i, async function() {
            await this.archive();
            await F.mainView.openDefaultThread();
            return false;
        }, {
            clientOnly: true,
            icon: 'archive',
            usage: '/archive',
            about: 'Archive this thread'
        });

        F.addComposeInputFilter(/^\/clear\b/i, async function() {
            await this.destroyMessages();
            return false;
        }, {
            icon: 'recycle',
            clientOnly: true,
            usage: '/clear',
            about: 'Clear your message history for this thread ' +
                   '(<i>other people are not affected</i>)'
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
            return `<b>v${F.version}</b> ` +
                   `<small>(<a target="_blank" href="https://github.com/ForstaLabs/relay-web-app/commits/${F.env.GIT_COMMIT}">` +
                   `${F.env.GIT_COMMIT.substring(0,10)}</a>)</small>`;
        }, {
            icon: 'birthday',
            usage: '/version',
            about: 'Show version information for this web app',
            clientOnly: true
        });

        F.addComposeInputFilter(/^\/giphy(?:\s+|$)(.*)/i, async function(term) {
            await F.mainView.threadStack.get(this).composeView.giphySearch(term);
            return false;
        }, {
            clientOnly: true,
            icon: 'image',
            usage: '/giphy SEARCH_TERM...',
            about: 'Send an animated GIF from https://giphy.com'
        });

        F.addComposeInputFilter(/^\/help(?:\s+|$)(--eggs)?(.*)?/i, function(eggs, command) {
            const show_eggs = !!eggs;
            const commands = [];
            command = command && command.trim().replace(/^\//, '');
            const filters = F.getComposeInputFilters().map(x => x.options);
            filters.sort((a, b) => a.usage < b.usage ? -1 : 1);
            for (const x of filters) {
                if (command) {
                    if (x.usage.replace(/^\//, '').split(/\s/, 1)[0] !== command) {
                        continue;
                    }
                } else if ((x.egg && !show_eggs) || !x.usage) {
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
            if (command && !commands.length) {
                return `<i class="icon warning sign red"></i><b>Command not found: ${command}</b>`;
            }
            return commands.join('<br/>');
        }, {
            usage: '/help [COMMAND]',
            icon: 'question',
            about: 'Display info about input command(s).',
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
            about: 'Display information pertaining to rich-text markdown syntax',
            clientOnly: true
        });

        F.addComposeInputFilter(/^\/join\s+(.*)/i, async function(expression) {
            const cleanExpr = relay.hub.sanitizeTags(expression, {type: 'conversation'});
            const thread = await F.foundation.allThreads.ensure(cleanExpr);
            F.mainView.openThread(thread);
        }, {
            icon: 'play',
            clientOnly: true,
            usage: '/join TAG_EXPRESSION...',
            about: 'Join, or create, a conversation matching the tag expression argument'
        });

        F.addComposeInputFilter(/^\/add\s+(.*)/i, async function(expression) {
            const dist = this.get('distribution');
            const adds = relay.hub.sanitizeTags(expression);
            const updated = await F.atlas.resolveTagsFromCache(`(${dist}) + (${adds})`,
                                                               {refresh: true});
            if (!updated.universal) {
                throw new Error("Invalid expression");
            }
            await this.save({distribution: updated.universal});
        }, {
            icon: 'add user',
            usage: '/add TAG_EXPRESSION...',
            about: 'Add users and/or tags to this thread ' +
                   '(E.g <i style="font-family: monospace">"/add @jim + @sales"</i>)'
        });

        F.addComposeInputFilter(/^\/remove\s+(.*)/i, async function(expression) {
            const dist = this.get('distribution');
            const removes = relay.hub.sanitizeTags(expression);
            const updated = await F.atlas.resolveTagsFromCache(`(${dist}) - (${removes})`);
            if (!updated.universal) {
                throw new Error("Invalid expression");
            }
            await this.save({distribution: updated.universal});
        }, {
            icon: 'remove user',
            usage: '/remove TAG_EXPRESSION...',
            about: 'Remove users and/or tags from this thread ' +
                   '(E.g. <i style="font-family: monospace">"/remove @mitch.hed:acme @doug.stanhope"</i>)'
        });

        F.addComposeInputFilter(/^\/members\b/i, async function() {
            const contacts = await F.atlas.getContacts(await this.getMembers());
            if (!contacts.length) {
                return '<i class="icon warning sign red"></i><b>No members in this thread</b>';
            }
            const outbuf = ['<div class="member-list">'];
            for (const x of contacts) {
                outbuf.push([
                    '<div class="member-row">',
                        '<div class="member-avatar">',
                            `<div class="f-avatar"><img src="${await x.getAvatarURL()}"/></div>`,
                        '</div>',
                        '<div class="member-info">',
                            `<a class="name" data-user-card="${x.id}">${x.getName()}</a>`,
                            `<div class="slug">${x.getTagSlug()}</div>`,
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

        F.addComposeInputFilter(/^\/link\s+(.*)/i, async function(url) {
            url = decodeURIComponent(url);
            const uuid = url.match(/[?&]uuid=([^&]*)/)[1];
            const pubKey = url.match(/[?&]pub_key=([^&]*)/)[1];
            if (!uuid || !pubKey) {
                throw new Error("Invalid link url");
            }
            const am = await F.foundation.getAccountManager();
            await am.linkDevice(uuid, atob(pubKey));
            return 'Successfully linked with ' + uuid;
        }, {
            clientOnly: true,
            egg: true,
            icon: 'lab',
            usage: '/link PROVISIONING_URL',
            about: 'Link a new device with this account'
        });

        F.addComposeInputFilter(/^\/pin\b/i, async function() {
            if (this.get('pinned')) {
                return '<i class="icon warning sign red"></i>Already Pinned';
            } else {
                await this.save('pinned', true);
                await this.sendUpdate({pinned: true});
                return '<i class="icon pin"></i>Pinned ' + this.get('type');
            }
        }, {
            clientOnly: true,
            icon: 'pin',
            usage: '/pin',
            about: 'Pin this thread'
        });

        F.addComposeInputFilter(/^\/unpin\b/i, async function() {
            if (!this.get('pinned')) {
                return '<i class="icon warning sign red"></i>Not Pinned';
            } else {
                await this.save('pinned', false);
                await this.sendUpdate({pinned: false});
                return '<i class="icon pin grey"></i>Unpinned ' + this.get('type');
            }
        }, {
            clientOnly: true,
            icon: 'pin grey',
            usage: '/unpin',
            about: 'Unpin this thread'
        });

        F.addComposeInputFilter(/^\/add-notice\s+([^\s]+)(?:\s+([^\s]+))?(?:\s+([^\s]+))?(?:\s+(.+))?/i,
                                async function(title, detail, className, icon) {
            this.addNotice({title, detail, className, icon});
        }, {
            egg: true,
            clientOnly: true,
            icon: 'tasks',
            usage: '/add-notice TITLE [DETAIL [CLASS] [ICON]',
            about: 'Unpin this thread'
        });

        F.addComposeInputFilter(/^\/endsession\s+(.*)/i, function(addr) {
            const ms = F.foundation.getMessageSender();
            ms.closeSession(addr);
        }, {
            egg: true,
            icon: 'bug',
            usage: '/endsession',
            about: 'End signal session for address'
        });
    }
})();
