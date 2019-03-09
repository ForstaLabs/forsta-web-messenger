/*
 * Utility lib that will buffer execution to a particular function until a period
 * of time has elapsed since first invocation or since last invocation.  This is
 * similar to _.debounce except we queue all the results.
 */

self.F = self.F || {};

self.F.buffered = function(func, wait, options) {
    options = options || {};
    const label = `${func.name || 'anonymous'})[${wait}ms]`;
    const maxWait = options.max;
    let invokePromise;
    let invokeResolve;
    let invokeReject;
    let bufferedArgs = [];
    let invokeTimeout = null;
    let started = null;

    const matures = () => maxWait ? Math.min(wait, maxWait - (Date.now() - started)) : wait;

    function invoke() {
        const args = bufferedArgs;
        bufferedArgs = [];
        invokeTimeout = null;
        started = null;
        let ret;
        try {
            ret = func.call(this, args);
        } catch(e) {
            invokeReject(e);
            console.error('Uncaught exception during buffered function invoke:', e, func);
            return;
        }
        if (ret instanceof Promise) {
            ret.then(invokeResolve);
            ret.catch(invokeReject);
        } else {
            invokeResolve(ret);
        }
    }
    Object.defineProperty(invoke, 'name', {value: `buffered-invoke(${label})`});

    const wrap = function() {
        bufferedArgs.push(arguments);
        if (!started) {
            started = Date.now();
            invokePromise = new Promise((resolve, reject) => {
                invokeResolve = resolve;
                invokeReject = reject;
            });
        } else if (invokeTimeout) {
            clearTimeout(invokeTimeout);
        }
        invokeTimeout = setTimeout(invoke.bind(this), matures());
        return invokePromise;
    };
    Object.defineProperty(wrap, 'name', {value: `buffered-wrap(${label})`});

    return wrap;
};
