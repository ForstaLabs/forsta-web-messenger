/*
 * vim: ts=4:sw=4:expandtab
 */
;(function(){
    'use strict';

    /*
     * WebSocket-Resources
     *
     * Create a request-response interface over websockets using the
     * WebSocket-Resources sub-protocol[1].
     *
     * var client = new WebSocketResource(socket, function(request) {
     *    request.respond(200, 'OK');
     * });
     *
     * client.sendRequest({
     *    verb: 'PUT',
     *    path: '/v1/messages',
     *    body: '{ some: "json" }',
     *    success: function(message, status, request) {...},
     *    error: function(message, status, request) {...}
     * });
     *
     * 1. https://github.com/WhisperSystems/WebSocket-Resources
     *
     */

    var Request = function(options) {
        this.verb    = options.verb || options.type;
        this.path    = options.path || options.url;
        this.body    = options.body || options.data;
        this.success = options.success;
        this.error   = options.error;
        this.id      = options.id;

        if (this.id === undefined) {
            var bits = new Uint32Array(2);
            window.crypto.getRandomValues(bits);
            this.id = dcodeIO.Long.fromBits(bits[0], bits[1], true);
        }

        if (this.body === undefined) {
            this.body = null;
        }
    };

    var IncomingWebSocketRequest = function(options) {
        var request = new Request(options);
        var socket = options.socket;

        this.verb = request.verb;
        this.path = request.path;
        this.body = request.body;

        this.respond = function(status, message) {
            socket.send(
                new textsecure.protobuf.WebSocketMessage({
                    type: textsecure.protobuf.WebSocketMessage.Type.RESPONSE,
                    response: { id: request.id, message: message, status: status }
                }).encode().toArrayBuffer()
            );
        };
    };

    var outgoing = {};
    var OutgoingWebSocketRequest = function(options, socket) {
        var request = new Request(options);
        outgoing[request.id] = request;
        socket.send(
            new textsecure.protobuf.WebSocketMessage({
                type: textsecure.protobuf.WebSocketMessage.Type.REQUEST,
                request: {
                    verb : request.verb,
                    path : request.path,
                    body : request.body,
                    id   : request.id
                }
            }).encode().toArrayBuffer()
        );
    };

    window.WebSocketResource = function(socket, opts) {
        opts = opts || {};
        var handleRequest = opts.handleRequest;
        if (typeof handleRequest !== 'function') {
            handleRequest = function(request) {
                request.respond(404, 'Not found');
            };
        }
        this.sendRequest = function(options) {
            return new OutgoingWebSocketRequest(options, socket);
        };

        socket.onmessage = function(socketMessage) {
            var blob = socketMessage.data;
            var reader = new FileReader();
            reader.onload = function() {
                var message = textsecure.protobuf.WebSocketMessage.decode(reader.result);
                if (message.type === textsecure.protobuf.WebSocketMessage.Type.REQUEST ) {
                    handleRequest(
                        new IncomingWebSocketRequest({
                            verb   : message.request.verb,
                            path   : message.request.path,
                            body   : message.request.body,
                            id     : message.request.id,
                            socket : socket
                        })
                    );
                }
                else if (message.type === textsecure.protobuf.WebSocketMessage.Type.RESPONSE ) {
                    var response = message.response;
                    var request = outgoing[response.id];
                    if (request) {
                        request.response = response;
                        var callback = request.error;
                        if (response.status >= 200 && response.status < 300) {
                            callback = request.success;
                        }

                        if (typeof callback === 'function') {
                            callback(response.message, response.status, request);
                        }
                    } else {
                        throw 'Received response for unknown request ' + message.response.id;
                    }
                }
            };
            reader.readAsArrayBuffer(blob);
        };

        if (opts.keepalive) {
            var keepalive = new KeepAlive(this, {
                path       : opts.keepalive.path,
                disconnect : opts.keepalive.disconnect
            });
            var resetKeepAliveTimer = keepalive.reset.bind(keepalive);
            socket.addEventListener('open', resetKeepAliveTimer);
            socket.addEventListener('message', resetKeepAliveTimer);
            socket.addEventListener('close', keepalive.stop.bind(keepalive));
        }

        this.close = function(code, reason) {
            if (!code) { code = 3000; }
            socket.close(code, reason);
        };

    };

    function KeepAlive(websocketResource, opts) {
        if (websocketResource instanceof WebSocketResource) {
            opts = opts || {};
            this.path = opts.path;
            if (this.path === undefined) {
                this.path = '/';
            }
            this.disconnect = opts.disconnect;
            if (this.disconnect === undefined) {
                this.disconnect = true;
            }
            this.wsr = websocketResource;
        } else {
            throw new TypeError('KeepAlive expected a WebSocketResource');
        }
    }

    KeepAlive.prototype = {
        constructor: KeepAlive,
        stop: function() {
            clearTimeout(this.keepAliveTimer);
            clearTimeout(this.disconnectTimer);
        },
        reset: function() {
            clearTimeout(this.keepAliveTimer);
            clearTimeout(this.disconnectTimer);
            this.keepAliveTimer = setTimeout(function() {
                this.wsr.sendRequest({
                    verb: 'GET',
                    path: this.path,
                    success: this.reset.bind(this)
                });
                if (this.disconnect) {
                    // automatically disconnect if server doesn't ack
                    this.disconnectTimer = setTimeout(function() {
                        clearTimeout(this.keepAliveTimer);
                        this.wsr.close(3001, 'No response to keepalive request');
                    }.bind(this), 1000);
                } else {
                    this.reset();
                }
            }.bind(this), 55000);
        },
    };

}());
