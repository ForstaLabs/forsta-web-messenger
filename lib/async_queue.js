// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    const _queueAsyncBuckets = new Map();

    async function _asyncQueueExecutor(queue, cleanup) {
        while (queue.length) {
            const job = queue.shift();
            try {
                job.resolve(await job.awaitable());
            } catch(e) {
                job.reject(e);
            }
        }
        cleanup();
    }

    F.queueAsync = function(bucket, awaitable) {
        /* Run the async awaitable only when all other async calls registered
         * here have completed (or thrown).  The bucket argument is a hashable
         * key representing the task queue to use. */
        let inactive;
        if (!_queueAsyncBuckets.has(bucket)) {
            _queueAsyncBuckets.set(bucket, []);
            inactive = true;
        }
        const queue = _queueAsyncBuckets.get(bucket);
        const job = new Promise((resolve, reject) => queue.push({
            awaitable, resolve, reject}));
        if (inactive) {
            /* An executor is not currently active; Start one now. */
            _asyncQueueExecutor(queue, () => _queueAsyncBuckets.delete(bucket));
        }
        return job;
    };
})();
