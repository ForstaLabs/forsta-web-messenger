// vim: ts=4:sw=4:expandtab
/* global Backbone ifrpc */

(function() {
    'use strict';

    self.F = self.F || {};
    F.surrogate = true;

    if (!self.opener) {
        throw new Error("Surrogate can only be loaded by the main app");
    }

    F.openerRPC = ifrpc.init(self.opener, {peerOrigin: self.origin});

    const _BackboneModelSave = Backbone.Model.prototype.save;
    Backbone.Model.prototype.save = async function() {
        const res = await _BackboneModelSave.apply(this, arguments);
        // Notify opener frame that we saved a model.  It might care.
        setTimeout(() => F.openerRPC.triggerEvent('model-save', {
            attributes: this.attributes,
            idAttribute: _.result(this, 'idAttribute'),
            storeName: this.storeName,
            databaseId: this.database && this.database.id,
        }), 0);
        return res;
    };

    const preloaded = (async () => {
        const contextReady = new Promise(resolve => {
            F.openerRPC.addCommandHandler('set-context', resolve);
        });
        F.openerRPC.triggerEvent('init', {peerOrigin: self.origin});
        await Backbone.initDatabase(F.SharedCacheDatabase);
        const ctx = F.surrogateContext = await contextReady;
        await F.atlas.setCurrentUser(ctx.user.id);
        await F.foundation.initSurrogate({threadId: ctx.thread.id});
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
