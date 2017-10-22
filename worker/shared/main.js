
(function() {
    const openPorts = [];

    addEventListener('connect', function(connectEvent) {
        for (const port of connectEvent.ports) {
            openPorts.push(port);
            port.addEventListener('message', msgEvent => {
                for (const p of openPorts) {
                    p.postMessage(msgEvent.data);
                }
            });
            port.start();
        }
    });
})();
