
(function() {
    const openPorts = [];

    addEventListener('connect', function(connectEvent) {
        for (const port of connectEvent.ports) {
            openPorts.push(port);
            port.addEventListener('message', msgEvent => {
                for (const p of openPorts) {
                    try {
                        p.postMessage(msgEvent.data);
                    } catch(e) {
                        console.error("Ignoring postmessage error:", e);
                    }
                }
            });
            port.start();
        }
    });
})();
