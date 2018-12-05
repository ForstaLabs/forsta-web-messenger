// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    const buckets = new Map();

    class Timeout extends Error {}

    function timeout(ms) {
        let id;
        const p = new Promise((_, reject) => {
            id = setTimeout(() => reject(new Timeout("Async Queue Timeout")), ms);
        });
        p.stop = () => clearTimeout(id);
        return p;
    }

    async function executor(queue, bucket) {
        let offt = 0;
        const gcLimit = 10000;
        while (true) {
            let limit = Math.min(queue.length, gcLimit); // Break up thundering hurds for GC duty.
            for (let i = offt; i < limit; i++) {
                const job = queue[i];
                const wedged = timeout(120 * 1000);
                try {
                    job.resolve(await Promise.race([wedged, job.awaitable()]));
                } catch(e) {
                    if (e instanceof Timeout) {
                        F.util.reportError("Possible async queue deadlock", bucket);
                    }
                    job.reject(e);
                } finally {
                    wedged.stop();
                }
            }
            if (limit < queue.length) {
                /* Perform lazy GC of queue for faster iteration. */
                if (limit >= gcLimit) {
                    queue.splice(0, limit);
                    offt = 0;
                } else {
                    offt = limit;
                }
            } else {
                break;
            }
        }
        buckets.delete(bucket);
    }

    F.queueAsync = function(bucket, awaitable) {
        /* Run the async awaitable only when all other async calls registered
         * here have completed (or thrown).  The bucket argument is a hashable
         * key representing the task queue to use. */
        if (!awaitable.name) {
            // Make debuging easier by adding a name to this function.
            Object.defineProperty(awaitable, 'name', {writable: true});
            if (typeof bucket === 'string') {
                awaitable.name = bucket;
            } else {
                console.warn("Unhandled bucket type (for naming):", typeof bucket, bucket);
            }
        }
        let inactive;
        if (!buckets.has(bucket)) {
            buckets.set(bucket, []);
            inactive = true;
        }
        const queue = buckets.get(bucket);
        const job = new Promise((resolve, reject) => queue.push({
            awaitable,
            resolve,
            reject
        }));
        if (inactive) {
            executor(queue, bucket);
        }
        return job;
    };
})();
