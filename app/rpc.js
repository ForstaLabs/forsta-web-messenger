// vim: ts=4:sw=4:expandtab
/* global ifrpc */

(function() {
    'use strict';

    self.F = self.F || {};

    const logger = F.log.getLogger('rpc');
 
    F.initRPC = async function(options) {
        F.assert(self !== self.parent, 'Not an iframe');
        options = options || {};
        logger.info("Starting ifrpc service");
        F.parentRPC = ifrpc.init(self.parent, {peerOrigin: F.env.RPC_ORIGIN});
        let configured;
        if (options.managed) {
            logger.warn("Starting messenger in managed mode.");
            configured = new Promise((resolve, reject) => {
                F.parentRPC.addCommandHandler('configure', config => {
                    F.managedConfig = config;
                    resolve();
                });
            });
        }
        F.parentRPC.triggerEvent('init');
        await configured;
    };
})();
