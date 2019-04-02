// vim: ts=4:sw=4:expandtab
/* global relay */

(function() {
    'use strict';

    async function onDBVersionChange() {
        F.util.confirmModal({
            header: 'Database was updated in another session',
            icon: 'database',
            content: 'The database in this session is stale.<br/><br/>' +
                     '<b>Reloading in 10 seconds...</b>',
            confirm: false,
            dismiss: false,
            closable: false
        });
        await relay.util.sleep(10);
        location.reload();
        await relay.util.never();
    }

    async function onDBBlocked() {
        await F.util.confirmModal({
            header: 'Database use blocked by another session',
            icon: 'database',
            content: 'The database is inaccessible due to activity in another session.  Please ' +
                     'close other tabs and/or restart your browser to resolve this condition.',
            confirmLabel: 'Reload',
            confirmIcon: 'refresh circle',
            dismiss: false,
            closable: false
        });
        location.reload();
        await relay.util.never();
    }

    const preloaded = (async () => {
        const params = new URLSearchParams(location.search);
        const theme = params.get('theme');
        if (theme) {
            F.util.chooseTheme(theme);
        }
        const logLevel = params.get('logLevel');
        if (logLevel) {
            const normLogLevel = logLevel.trim().toLowerCase();
            const noop = () => undefined;
            if (normLogLevel === 'info') {
                console.debug = noop;
            } else if (normLogLevel.startsWith('warn')) {
                console.debug = noop;
                console.info = noop;
                console.log = noop;
            } else if (normLogLevel == 'error') {
                console.debug = noop;
                console.info = noop;
                console.log = noop;
                console.warn = noop;
            }
        }
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

    addEventListener('dbversionchange', onDBVersionChange);
    addEventListener('dbblocked', onDBBlocked);
    addEventListener('load', main);
}());
