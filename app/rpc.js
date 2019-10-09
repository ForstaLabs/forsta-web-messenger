// vim: ts=4:sw=4:expandtab
/* global ifrpc */

(function() {
    'use strict';

    self.F = self.F || {};

    const logger = F.log.getLogger('rpc');
 
    F.initRPC = async function(parentFrame, scope) {
        F.assert(self !== parentFrame);
        logger.warn(`Starting ${scope} messenger in managed mode.`);
        F.parentRPC = ifrpc.init(parentFrame, {peerOrigin: F.env.RPC_ORIGIN});
        let configured;
        configured = new Promise((resolve, reject) => {
            F.parentRPC.addCommandHandler('configure', config => {
                F.managedConfig = config;
                resolve();
            });
        });
        F.parentRPC.triggerEvent('init', {scope});
        await configured;
    };
})();
