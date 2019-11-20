// vim: ts=4:sw=4:expandtab
/* global ifrpc relay */

(function() {
    'use strict';

    self.F = self.F || {};

    const logger = F.log.getLogger('rpc');
 
    function requireThread(threadId) {
        const thread = F.foundation.allThreads.get(threadId);
        if (!thread) {
            throw new ReferenceError("Invalid ThreadID");
        }
        return thread;
    }


    const handlers = {
        "thread-ensure": async function(expression, attrs) {
            F.assert(expression, 'Expected tag expression argument');
            F.assert(typeof expression === 'string', 'String argument expected');
            const cleanExpr = relay.hub.sanitizeTags(expression);
            const thread = await F.foundation.allThreads.ensure(cleanExpr, attrs);
            return thread.id;
        },

        "thread-make": async function(expression, attrs) {
            F.assert(expression, 'Expected tag expression argument');
            F.assert(typeof expression === 'string', 'String argument expected');
            const cleanExpr = relay.hub.sanitizeTags(expression);
            const thread = await F.foundation.allThreads.make(cleanExpr, attrs);
            return thread.id;
        },

        "thread-open": async function(threadId) {
            await F.mainView.openThreadById(threadId);
        },
         
        "thread-call-start": async function(threadId, autoJoinBool) {
            const thread = requireThread(threadId);
            const callMgr = F.calling.getOrCreateManager(thread.id, thread);
            await callMgr.start({autoJoin: autoJoinBool});
        },
 
        "thread-call-join": async function(threadId) {
            const thread = requireThread(threadId);
            const callMgr = F.calling.getOrCreateManager(thread.id, thread);
            await callMgr.start({autoJoin: true});
        },

        "thread-list": function() {
            return F.foundation.allThreads.models.map(x => x.id);
        },


        "thread-list-attributes": function(threadId) {
            const thread = requireThread(threadId);
            return Object.keys(thread.attributes);
        },

        "thread-get-attribute": function(threadId, attr) {
            const thread = requireThread(threadId);
            return thread.get(attr);
        },

        "thread-set-attribute": async function(threadId, attr, value) {
            const thread = requireThread(threadId);
            thread.set(attr, value);
            await thread.save();
        },

        "thread-set-expiration": async function(threadId, expiration) {
            const thread = requireThread(threadId);
            if (typeof expiration !== 'number') {
                throw new TypeError('expiration must be number (seconds)');
            }
            await thread.sendExpirationUpdate(expiration);
        },

        "thread-send-update": async function(threadId, updates, options) {
            const thread = requireThread(threadId);
            await thread.sendUpdate(updates, options);
        },

        "thread-send-message": async function(threadId) {
            const thread = requireThread(threadId);
            const msg = await thread.sendMessage.apply(thread, Array.from(arguments).slice(1));
            return msg.id;
        },

        "thread-send-control": async function(threadId) {
            const thread = requireThread(threadId);
            await thread.sendControl.apply(thread, Array.from(arguments).slice(1));
        },

        "thread-archive": async function(threadId, options) {
            const thread = requireThread(threadId);
            await thread.archive(options);
        },

        "thread-restore": async function(threadId, options) {
            const thread = await F.foundation.allThreads.getAndRestore(threadId, options);
            if (!thread) {
                throw new ReferenceError("Invalid ThreadID");
            }
        },

        "thread-expunge": async function(threadId, options) {
            const thread = requireThread(threadId);
            await thread.expunge(options);
        },

        "thread-destroy-messages": async function(threadId) {
            const thread = requireThread(threadId);
            await thread.destroyMessages();
        },

        "thread-add-member": async function(threadId, userId) {
            const thread = requireThread(threadId);
            return await thread.addMember(userId);
        },

        "thread-remove-member": async function(threadId, userId) {
            const thread = requireThread(threadId);
            return await thread.removeMember(userId);
        },

        "thread-leave": async function(threadId) {
            const thread = requireThread(threadId);
            await thread.leave();
        },

        "thread-amend-distribution": async function(threadId, expression) {
            const thread = requireThread(threadId);
            return await thread.amendDistribution(expression);
        },

        "thread-repeal-distribution": async function(threadId, expression) {
            const thread = requireThread(threadId);
            return await thread.repealDistribution(expression);
        },

        "nav-panel-toggle": async function(collapse) {
            F.mainView.toggleNavBar(collapse);
        }
    };


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

        for (const [command, handler] of Object.entries(handlers)) {
            F.parentRPC.addCommandHandler(command, handler);
        }

        self.addEventListener('provisioningrequired', ev => F.parentRPC.triggerEvent('provisioningrequired'));
        self.addEventListener('provisioningerror', ev => F.parentRPC.triggerEvent('provisioningerror', ev.error));
        self.addEventListener('provisioningdone', ev => F.parentRPC.triggerEvent('provisioningdone'));
        self.addEventListener('loaded', ev => F.parentRPC.triggerEvent('loaded'));
        self.addEventListener('thread-message', ev => F.parentRPC.triggerEvent('thread-message', ev.data));
        self.addEventListener('thread-message-readmark', ev => F.parentRPC.triggerEvent('thread-message-readmark', ev.data));

        F.parentRPC.triggerEvent('init', {scope});
        await configured;
    };

})();
