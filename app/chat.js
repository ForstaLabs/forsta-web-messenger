// vim: ts=4:sw=4:expandtab
/* global */

(function() {
    'use strict';

    const preloaded = (async () => {
        await F.cache.startSharedCache();
    })();

    async function main() {
        await preloaded;
        console.info('%cStarting Forsta Chat Client',
                     'font-size: 120%; font-weight: bold;');

        const urlMatch = location.pathname.match(/^\/@chat\/([^/?]*)/);
        const token = urlMatch && urlMatch[1];
        if (!token) {
            F.util.confirmModal({
                header: 'Token Required',
                icon: 'red warning sign',
                content: `An chat token is required in the URL.  e.g. ` +
                         `<samp>${location.origin}/@chat/&lt;token-here&gt;</samp>`,
                confirm: false,
                dismiss: false,
                closable: false
            });
            return;
        }
        const params = new URLSearchParams(location.search);
        const convo = await F.atlas.chatLogin(token, params);
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
