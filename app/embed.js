// vim: ts=4:sw=4:expandtab
/* global relay Backbone */

(function() {
    'use strict';

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
        'disableHeader',
        'disableMessageInfo',
        'disableSenderInfo',
        'disableRecipientsPrompt',
        'conversation',
        'call',
        'allowCalling',
    ];

    async function loadFoundation() {
        const firstInit = !(await F.state.get('registered'));
        if (firstInit) {
            await F.foundation.initRelay();
            const am = await F.foundation.getAccountManager();
            // Reduce the time spent generating prekeys we'll likely never need.
            am.preKeyLowWater = 5;
            am.preKeyHighWater = 15;
            await am.registerAccount(F.foundation.generateDeviceName());
        }
        await F.foundation.initApp({firstInit});
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
        await F.util.validateBrowser();
        await Backbone.initDatabase(F.SharedCacheDatabase);
    })();

    async function main() {
        await preloaded;
        console.info('%cStarting Forsta Embedded Client',
                     'font-size: 120%; font-weight: bold;');

        const params = new URLSearchParams(location.search);
        const viewOptions = {
            title: urlQuery.get('title'),
            call: urlQuery.has('call'),
            allowCalling: urlQuery.has('allowCalling'),
            forceScreenSharing: urlQuery.has('forceScreenSharing'),
            disableHeader: urlQuery.has('disableHeader'),
            disableCommands: urlQuery.has('disableCommands'),
            disableMessageInfo: urlQuery.has('disableMessageInfo'),
            disableSenderInfo: urlQuery.has('disableSenderInfo'),
            disableRecipientsPrompt: urlQuery.has('disableRecipientsPrompt'),
            beaconExtraUrlParams: Array.from(urlQuery.entries())
                                       .filter(([k, v]) => urlParamBlacklist.indexOf(k) === -1)
                                       .reduce((acc, [k, v]) => (acc[k] = v, acc), {})
        };

        const conversationToken = params.get('conversation');
        if (conversationToken) {
            const info = await F.atlas.chatLogin(conversationToken, params);
            viewOptions.to = info.distribution;
            viewOptions.threadId = info.threadId;
            viewOptions.conversationToken = conversationToken;
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

        F.mainView = new F.EmbedView(viewOptions);
        await F.mainView.render();
        await F.mainView.openDefaultThread();

        $('body > .ui.dimmer').removeClass('active');
        console.info(`Messenger load time: ${Math.round(performance.now())}ms`);
    }

    addEventListener('load', main);
}());
