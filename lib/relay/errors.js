/*
 * vim: ts=4:sw=4:expandtab
 */

(function() {
    'use strict';

    const ns = self.relay = self.relay || {};

    const registeredFunctions = {};
    const Type = {
        ENCRYPT_MESSAGE: 1,
        INIT_SESSION: 2,
        TRANSMIT_MESSAGE: 3,
        REBUILD_MESSAGE: 4,
    };

    ns.replay = {
        Type: Type,
        registerFunction: function(func, functionCode) {
            registeredFunctions[functionCode] = func;
        }
    };

    class RelayError extends Error {}

    function ReplayableError(options) {
        options = options || {};
        this.name         = options.name || 'ReplayableError';
        this.functionCode = options.functionCode;
        this.args         = options.args;
    }
    ReplayableError.prototype = new RelayError();
    ReplayableError.prototype.constructor = ReplayableError;

    ReplayableError.prototype.replay = function() {
        return registeredFunctions[this.functionCode].apply(this, this.args);
    };

    function IncomingIdentityKeyError(addr, message, key) {
        ReplayableError.call(this, {
            functionCode: Type.INIT_SESSION,
            args: [addr, message]
        });
        this.addr = addr.split('.')[0];
        this.name = 'IncomingIdentityKeyError';
        this.message = "The identity of " + this.addr + " has changed.";
        this.identityKey = key;
    }
    IncomingIdentityKeyError.prototype = new ReplayableError();
    IncomingIdentityKeyError.prototype.constructor = IncomingIdentityKeyError;

    function OutgoingIdentityKeyError(addr, message, timestamp, identityKey) {
        ReplayableError.call(this, {
            functionCode: Type.ENCRYPT_MESSAGE,
            args: [addr, message, timestamp]
        });
        this.addr = addr.split('.')[0];
        this.name = 'OutgoingIdentityKeyError';
        this.message = "The identity of " + this.addr + " has changed.";
        this.identityKey = identityKey;
    }
    OutgoingIdentityKeyError.prototype = new ReplayableError();
    OutgoingIdentityKeyError.prototype.constructor = OutgoingIdentityKeyError;

    function OutgoingMessageError(addr, message, timestamp, httpError) {
        ReplayableError.call(this, {
            functionCode: Type.ENCRYPT_MESSAGE,
            args: [addr, message, timestamp]
        });
        this.name = 'OutgoingMessageError';
        if (httpError) {
            this.code = httpError.code;
            this.message = httpError.message;
            this.stack = httpError.stack;
        }
    }
    OutgoingMessageError.prototype = new ReplayableError();
    OutgoingMessageError.prototype.constructor = OutgoingMessageError;

    function SendMessageError(addr, jsonData, httpError, timestamp) {
        ReplayableError.call(this, {
            functionCode: Type.TRANSMIT_MESSAGE,
            args: [addr, jsonData, timestamp]
        });
        this.name = 'SendMessageError';
        this.addr = addr;
        this.code = httpError.code;
        this.message = httpError.message;
        this.stack = httpError.stack;
    }
    SendMessageError.prototype = new ReplayableError();
    SendMessageError.prototype.constructor = SendMessageError;

    function MessageError(message, httpError) {
        ReplayableError.call(this, {
            functionCode: Type.REBUILD_MESSAGE,
            args: [message]
        });
        this.name = 'MessageError';
        this.code = httpError.code;
        this.message = httpError.message;
        this.stack = httpError.stack;
    }
    MessageError.prototype = new ReplayableError();
    MessageError.prototype.constructor = MessageError;

    function UnregisteredUserError(addr, httpError) {
        this.name = 'UnregisteredUserError';
        this.addr = addr;
        this.code = httpError.code;
        this.message = httpError.message;
        this.stack = httpError.stack;
    }
    UnregisteredUserError.prototype = new RelayError();
    UnregisteredUserError.prototype.constructor = UnregisteredUserError;

    class ProtocolError extends RelayError {
        constructor(code, response) {
            super();
            this.name = 'ProtocolError';
            if (code > 999 || code < 100) {
                code = -1;
            }
            this.code = code;
            this.response = response;
        }
    }

    class NetworkError extends RelayError {
        constructor(a, b, c) {
            super(a, b, c);
            this.name = 'NetworkError';
        }
    }

    ns.UnregisteredUserError = UnregisteredUserError;
    ns.IncomingIdentityKeyError = IncomingIdentityKeyError;
    ns.OutgoingIdentityKeyError = OutgoingIdentityKeyError;
    ns.RelayError = RelayError;
    ns.ReplayableError = ReplayableError;
    ns.OutgoingMessageError = OutgoingMessageError;
    ns.MessageError = MessageError;
    ns.SendMessageError = SendMessageError;
    ns.ProtocolError = ProtocolError;
    ns.NetworkError = NetworkError;
})();
