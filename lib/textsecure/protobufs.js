// vim: ts=4:sw=4:expandtab
/* global dcodeIO */

(function() {
    'use strict';

    self.textsecure = self.textsecure || {};
    textsecure.protobuf = {};

    const path = '/@static/protos/';
    const manifest = [
        'IncomingPushMessageSignal.proto',
        'SubProtocol.proto',
        'DeviceMessages.proto'
    ];

    async function loadProtoBufs(filename) {
        const resp = await fetch(path + filename + `?v=${F.env.GIT_COMMIT.substring(0, 8)}`);
        const data = await resp.text();
        if (!resp.ok) {
            throw new Error(data);
        }
        const buf = dcodeIO.ProtoBuf.loadProto(data);
        const protos = buf.build('textsecure');
        for (var protoName in protos) {
            textsecure.protobuf[protoName] = protos[protoName];
        }
    }

    textsecure.protobuf.load = async function() {
        await Promise.all(manifest.map(loadProtoBufs));
    };
})();
