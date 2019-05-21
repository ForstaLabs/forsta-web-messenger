// vim: ts=4:sw=4:expandtab
/* global ifrpc */

(function() {
    'use strict';

    self.F = self.F || {};
    F.surrogate = true;

    if (!self.opener) {
        throw new Error("Surrogate can only be loaded by the main app");
    }

    const preloaded = (async () => {
        F.openerRPC = ifrpc.init(self.opener, {peerOrigin: self.origin});
        const contextReady = new Promise(resolve => F.openerRPC.addCommandHandler('set-context', resolve));
        F.openerRPC.triggerEvent('init', {peerOrigin: self.origin});
        await Promise.all([
            F.foundation.initRelay(),
            contextReady
        ]);
        const ctx = F.surrogateContext = await contextReady;
        const user = new F.Contact(ctx.user);
        F.Database.setId(user.id);
        F.Database.setRPC(F.openerRPC);
        F.Database.readonly = true;
        F.cache.SharedDatabaseCacheStore.setReady(true);
        F.cache.UserDatabaseCacheStore.setReady(true);
        await F.cache.startSharedCache();
        F.currentUser = user;
        F.currentDevice = ctx.deviceId;
        F.util.setIssueReportingContext({
            id: user.id,
            slug: user.getTagSlug({full: true}),
            name: user.getName()
        });
    })();

    async function main() {
        await preloaded;
        F.log.info('<big><b>Starting Forsta Surrogate</b></big>');

        await Promise.all([
            F.util.startIssueReporting(),
            F.util.startUsageReporting(),
            F.tpl.loadPartials(),
        ]);

        const thread = new F.Thread(F.surrogateContext.thread);
        F.mainView = new F.SurrogateView({thread});
        await F.mainView.render();

        console.info(`Surrogate load time: ${Math.round(performance.now())}ms`);
    }

    addEventListener('load', main);
}());
