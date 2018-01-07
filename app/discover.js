// vim: ts=4:sw=4:expandtab
/* global relay gapi */

(function () {
    'use strict';

    self.F = self.F || {};
    const ns = F.discover = {};

    const scope = 'https://www.googleapis.com/auth/contacts.readonly';

    let _googleApiInit;

    async function initGoogleApi() {
        await new Promise((resolve, reject) => {
            $.ajax({
                url: 'https://apis.google.com/js/api.js',
                dataType: 'script',
                cache: true
            }).then(resolve).catch(reject);
        });
        await new Promise((resolve, reject) => {
            gapi.load('client:auth2', {
                callback: resolve,
                onerror: reject,
                ontimeout: reject,
                timeout: 30000,
            });
        });
        await gapi.client.init({
            clientId: F.env.DISCOVER_GOOGLE_AUTH_CLIENT_ID,
            scope,
            discoveryDocs: ['https://people.googleapis.com/$discovery/rest']
        });
    }


    async function _getGoogleContacts() {
        const contacts = [];
        let pageToken;
        let backoff = 1;
        let resp;
        do {
            try {
                resp = await gapi.client.people.people.connections.list({
                    resourceName: 'people/me',
                    personFields: 'emailAddresses,phoneNumbers',
                    pageSize: 20,
                    pageToken
                });
            } catch(e) {
                if (e.status === 429) {
                    console.warn('Throttling contact request:', backoff);
                    await relay.util.sleep((backoff *= 2));
                    continue;
                } else {
                    throw e;
                }
            }
            for (const c of resp.result.connections) {
                if (c.phoneNumbers) {
                    for (const x of c.phoneNumbers) {
                        const phone = x.value.trim();
                        if (phone) {
                            contacts.push({phone});
                        }
                    }
                }
                if (c.emailAddresses) {
                    for (const x of c.emailAddresses) {
                        const email = x.value.trim();
                        if (email) {
                            contacts.push({email});
                        }
                    }
                }
            }
            pageToken = resp.result.nextPageToken;
        } while(pageToken);
        return contacts;
    }

    ns.getGoogleContacts = async function() {
        if (!_googleApiInit) {
            _googleApiInit = initGoogleApi();
        }
        await _googleApiInit;
        const GoogleAuth = gapi.auth2.getAuthInstance();
        const proceed = await F.util.confirmModal({
            icon: 'google',
            header: "Grant access to your Google contacts",
            content: "To proceed you must give Forsta <u>temporary</u> access to your " +
                     "Google contacts.  This information is never kept in our servers " +
                     "and is used strictly to check for existing Forsta users."
        });
        if (!proceed) {
            return;
        }
        await GoogleAuth.signIn();
        let contacts;
        try {
            contacts = await _getGoogleContacts();
        } finally {
            GoogleAuth.disconnect();
            await GoogleAuth.signOut();
        }
        return contacts;
    };

    ns.importContacts = async function(contacts) {
        const phones = new Set();
        const emails = new Set();
        const prefixSize = F.currentUser.get('phone').length - 7;
        const defaultPrefix = F.currentUser.get('phone').substr(0, prefixSize);
        for (const c of contacts) {
            if (c.email) {
                emails.add(c.email);
            }
            if (c.phone) {
                const phone = c.phone.replace(/[^0-9+]/g, '');
                if (phone.length < 7) {
                    console.warn("Dropping invalid phone number:", c.phone);
                    continue;
                } else if (phone.length === 7) {
                    phones.add(defaultPrefix + phone);
                } else if (phone.length === 10) {
                    console.assert(!phone.match(/\+/));
                    phones.add('+1' + phone);
                } else if (phone.length === 11) {
                    console.assert(!phone.match(/\+/));
                    phones.add('+' + phone);
                } else {
                    console.assert(phone.match(/\+/));
                    phones.add(phone);
                }
            }
        }
        const searchResults = (await F.atlas.searchContacts({
            phone_in: Array.from(phones)
        })).concat(await F.atlas.searchContacts({
            email_in: Array.from(emails)
        }));
        const contactCollection = F.foundation.getContacts();
        const matches = searchResults.filter(x => !contactCollection.get(x.id));
        if (matches.length) {
            if (await F.util.confirmModal({
                header: `Found ${matches.length} new contacts`,
                content: `<h5>Add these contacts?</h5>` +
                         matches.map(x => `${x.getName()} (${x.getTagSlug()})`).join('<br/>')
            })) {
                await Promise.all(matches.map(x => x.save()));
                contactCollection.add(matches);
            }
        } else {
            await F.util.promptModal({
                header: "No new contacts found"
            });
        }
    };
})();
