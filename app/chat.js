// vim: ts=4:sw=4:expandtab
/* global Backbone */

(function() {
    'use strict';

    const logger = F.log.getLogger('chat');

    const preloaded = (async () => {
        await F.util.validateBrowser();
        await Backbone.initDatabase(F.SharedCacheDatabase);
    })();

    async function blockingModal(options) {
        await F.util.confirmModal(Object.assign({
            icon: 'red warning sign',
            size: 'small',
            confirm: false,
            dismiss: false,
            closable: false
        }, options));
        await F.never();
    }

    async function main() {
        await preloaded;
        logger.info('<large><sans><b>Starting Forsta Chat Client</b></sans></large>');

        const urlMatch = location.pathname.match(/^\/@chat\/([^/?]*)/);
        const token = urlMatch && urlMatch[1];
        if (!token) {
            await blockingModal({
                header: 'Token Required',
                content: `An chat token is required in the URL.  e.g. ` +
                         `<samp>${location.origin}/@chat/&lt;token-here&gt;</samp>`,
            });
            throw new Error('unreachable');
        }
        const params = new URLSearchParams(location.search);
        let convo;
        try {
            convo = await F.atlas.chatLogin(token, params);
        } catch(e) {
            if (e.apiError) {
                if (e.apiError.expires) {
                    await blockingModal({
                        header: 'Conversation Link Expired',
                        content: `This URL has expired.`
                    });
                } else {
                    await blockingModal({
                        header: 'Conversation Error',
                        content: e.apiError
                    });
                }
            } else {
                await blockingModal({
                    header: 'Conversation Error',
                    content: e.message
                });
            }
            throw new Error('unreachable');
        }
        const query = {
            call: params.get('call')
        };
        if (convo.embed) {
            query.conversation = token;
            location.assign(`/@embed${F.util.urlQuery(query)}`);
        } else {
            location.assign(`/@/conversation/${token}${F.util.urlQuery(query)}`);
        }
    }

    addEventListener('load', main);
}());
