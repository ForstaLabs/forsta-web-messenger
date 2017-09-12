// vim: ts=4:sw=4:expandtab
/* global dcodeIO */

(function(){
    'use strict';

    /*
     * WebSocket-Resources
     *
     * Create a request-response interface over websockets using the
     * WebSocket-Resources sub-protocol[1].
     *
     * const client = new WebSocketResource(socket, function(request) {
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

    class Request {
        constructor(options) {
            this.verb = options.verb || options.type;
            this.path = options.path || options.url;
            this.body = options.body || options.data;
            this.success = options.success;
            this.error = options.error;
            this.socket = options.socket;
            this.id = options.id;
            if (!this.id) {
                const bits = new Uint32Array(2);
                crypto.getRandomValues(bits);
                this.id = dcodeIO.Long.fromBits(bits[0], bits[1], true);
            }
            if (this.body === undefined) {
                this.body = null;
            }
        }
    }

    class IncomingWebSocketRequest extends Request {
        respond(status, message) {
            const msg = new textsecure.protobuf.WebSocketMessage({
                type: textsecure.protobuf.WebSocketMessage.Type.RESPONSE,
                response: {
                    id: this.id,
                    message,
                    status
                }
            }).encode().toArrayBuffer();
            return this.socket.send(msg);
        }
    }

    class OutgoingWebSocketRequest extends Request {
        send() {
            const msg = new textsecure.protobuf.WebSocketMessage({
                type: textsecure.protobuf.WebSocketMessage.Type.REQUEST,
                request: {
                    verb: this.verb,
                    path: this.path,
                    body: this.body,
                    id: this.id
                }
            }).encode().toArrayBuffer();
            return this.socket.send(msg);
        }
    }

    class KeepAlive {
        constructor(websocketResource, opts) {
            if (!(websocketResource instanceof WebSocketResource)) {
                throw new TypeError('KeepAlive expected a WebSocketResource');
            }
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
        }

        stop() {
            clearTimeout(this.keepAliveTimer);
            clearTimeout(this.disconnectTimer);
        }

        reset() {
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
            }.bind(this), 50000);
        }
    }

    class WebSocketResource {

        constructor(socket, opts) {
            this.socket = socket;
            this.outgoingRequests = new Map();
            opts = opts || {};
            this.handleRequest = opts.handleRequest;
            if (typeof this.handleRequest !== 'function') {
                this.handleRequest = request => request.respond(404, 'Not found');
            }
            socket.addEventListener('message', this.onMessage.bind(this));
            if (opts.keepalive) {
                const keepalive = new KeepAlive(this, {
                    path: opts.keepalive.path,
                    disconnect: opts.keepalive.disconnect
                });
                const resetKeepAliveTimer = keepalive.reset.bind(keepalive);
                socket.addEventListener('open', resetKeepAliveTimer);
                socket.addEventListener('message', resetKeepAliveTimer);
                socket.addEventListener('close', keepalive.stop.bind(keepalive));
            }
        }

        sendRequest(options) {
            const reqOpts = Object.assign({socket: this.socket}, options);
            const request = new OutgoingWebSocketRequest(reqOpts);
            this.outgoingRequests.set(request.id.toNumber(), request);
            request.send();
            return request;
        }

        close(code, reason) {
            if (!code) {
                code = 3000;
            }
            this.socket.close(code, reason);
        }

        async onMessage(encodedMsg) {
            const reader = new FileReader();
            await new Promise((resolve, reject) => {
                reader.onload = resolve;
                reader.onabort = reader.onerror = reject;
                reader.readAsArrayBuffer(encodedMsg.data);
            });
            const message = textsecure.protobuf.WebSocketMessage.decode(reader.result);
            if (message.type === textsecure.protobuf.WebSocketMessage.Type.REQUEST) {
                await this.handleRequest(new IncomingWebSocketRequest({
                    verb: message.request.verb,
                    path: message.request.path,
                    body: message.request.body,
                    id: message.request.id,
                    socket: this.socket
                }));
            } else if (message.type === textsecure.protobuf.WebSocketMessage.Type.RESPONSE) {
                const response = message.response;
                const key = response.id.toNumber();
                if (this.outgoingRequests.has(key)) {
                    const request = this.outgoingRequests.get(key);
                    this.outgoingRequests.delete(key);
                    request.response = response;
                    let callback;
                    if (response.status >= 200 && response.status < 300) {
                        callback = request.success;
                    } else {
                        callback = request.error;
                    }
                    if (typeof callback === 'function') {
                        await callback(response.message, response.status, request);
                    }
                } else {
                    console.error('Unmatched websocket response', key, message, encodedMsg);
                    throw ReferenceError('Unmatched WebSocket Response');
                }
            } else {
                throw new TypeError(`Unhandled message type: ${message.type}`);
            }
        }
    }

    self.WebSocketResource = WebSocketResource;
}());
