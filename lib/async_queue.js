// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    const _queueAsyncBuckets = new Map();

    async function _asyncQueueExecutor(queue) {
        while (queue.length) {
            /* Do not pop head until after work is done to signal to outside
             * callers that we are here doing work and can pickup more tasks. */
            const job = queue[0];
            try {
                job.resolve(await job.call());
            } catch(e) {
                job.reject(e);
            } finally {
                queue.shift();
            }
        }
    }

    F.queueAsync = function(bucket, call) {
        /* Run the async call only when all other async calls registered
         * here have completed (or thrown).  The bucket argument is a hashable
         * key representing the task queue to use. */
        if (!_queueAsyncBuckets.has(bucket)) {
            _queueAsyncBuckets.set(bucket, []);
        }
        const queue = _queueAsyncBuckets.get(bucket);
        const whenDone = new Promise((resolve, reject) => queue.push({
            call, resolve, reject}));
        if (queue.length === 1) {
            /* An executor is not currently active; Start one now. */
            _asyncQueueExecutor(queue);
        }
        return whenDone;
    };
})();
