// vim: ts=4:sw=4:expandtab
/* global relay */

(function() {
    'use strict';

    const sessionId = F.util.uuid4();
    const urlQuery = new URLSearchParams(location.search);
    const urlParamBlacklist = [
        'token',
        'to',
        'first_name',
        'last_name',
        'email',
        'phone',
        'title',
        'threadId',
        'disableCommands',
        'logLevel',
        'disableMessageInfo',
        'disableSenderInfo',
        'disableRecipientsPrompt'
    ];

    async function onSharedWorkerMessage(ev) {
        /* Our shared worker lets us detect duplicate sessions by pinging any listeners
         * on startup.   We assume that anyone pinging us is a newer session and suspend
         * our session out of respect for the newer tab. */
        if (ev.data.sessionId === sessionId) {
            return;
        }
        // Not us and newer than us, time to RIP...
        console.warn("Suspending this session due to external activity");
        F.sharedWorker.port.removeEventListener('message', onSharedWorkerMessage);
        stopServices();
        await F.util.confirmModal({
            header: 'Session Suspended',
            icon: 'pause circle',
            content: 'Another tab was opened on this computer.',
            footer: 'Only one session per browser can be active to avoid ' +
                    'consistency problems.',
            confirmLabel: 'Restart this session',
            confirmIcon: 'refresh',
            dismiss: false,
            closable: false
        });
        location.reload();
        await relay.util.never();
    }

    function loadWorkers() {
        if (self.SharedWorker) {
            F.sharedWorker = new SharedWorker(F.urls.worker_shared);
            F.sharedWorker.port.start();
            F.sharedWorker.port.addEventListener('message', onSharedWorkerMessage);
            F.sharedWorker.port.postMessage({sessionId});
        }
    }

    async function loadFoundation() {
        if (!(await F.state.get('registered'))) {
            const am = await F.foundation.getAccountManager();
            await am.registerAccount(F.foundation.generateDeviceName());
        }
        await F.foundation.initApp();
    }

    function stopServices() {
        const mr = F.foundation.getMessageReceiver();
        if (mr) {
            mr.close();
        }
    }

    async function onDBVersionChange() {
        stopServices();
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
        stopServices();
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
        console.info('%cStarting Forsta Embedded Client',
                     'font-size: 120%; font-weight: bold;');

        const params = new URLSearchParams(location.search);
        const viewOptions = {
            title: urlQuery.get('title'),
            to: relay.hub.sanitizeTags(urlQuery.get('to') || '@support:forsta.io'),
            threadId: urlQuery.get('threadId'),
            allowCalling: urlQuery.has('allowCalling'),
            forceScreenSharing: urlQuery.has('forceScreenSharing'),
            disableCommands: urlQuery.has('disableCommands'),
            disableMessageInfo: urlQuery.has('disableMessageInfo'),
            disableSenderInfo: urlQuery.has('disableSenderInfo'),
            disableRecipientsPrompt: urlQuery.has('disableRecipientsPrompt'),
            beaconExtraUrlParams: Array.from(urlQuery.entries())
                                       .filter(([k, v]) => urlParamBlacklist.indexOf(k) === -1)
                                       .reduce((acc, [k, v]) => (acc[k] = v, acc), {})
        };

        if (params.get('conversation')) {
            const info = await F.atlas.conversationLogin(params);
            viewOptions.to = info.distribution;
            viewOptions.threadId = info.threadId;
        } else {
            if (!params.get('token')) {
                F.util.confirmModal({
                    header: 'Token Required',
                    icon: 'red warning sign',
                    content: 'An embedded client token is required.  e.g. ' +
                             '<samp>https://app.forsta.io/@embed?token=ORG_EPHEMERAL_USER_TOKEN</samp>',
                    confirm: false,
                    dismiss: false,
                    closable: false
                });
                return;
            }
            await F.atlas.ephemeralLogin(params);
            viewOptions.to = relay.hub.sanitizeTags(urlQuery.get('to') || '@support:forsta.io');
            viewOptions.threadId = urlQuery.get('threadId');
        }

        await Promise.all([
            F.util.startIssueReporting(),
            F.util.startUsageReporting(),
            F.tpl.loadPartials(),
            loadFoundation()
        ]);
        loadWorkers();

        F.mainView = new F.EmbedView(viewOptions);
        await F.mainView.render();
        await F.mainView.openDefaultThread();

        $('body > .ui.dimmer').removeClass('active');
        console.info(`Messenger load time: ${Math.round(performance.now())}ms`);
    }

    addEventListener('dbversionchange', onDBVersionChange);
    addEventListener('dbblocked', onDBBlocked);
    addEventListener('load', main);
}());
