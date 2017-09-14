/*
 * vim: ts=4:sw=4:expandtab
 */

(function() {
    'use strict';

    var registeredFunctions = {};
    var Type = {
        ENCRYPT_MESSAGE: 1,
        INIT_SESSION: 2,
        TRANSMIT_MESSAGE: 3,
        REBUILD_MESSAGE: 4,
    };
    self.textsecure = self.textsecure || {};
    self.textsecure.replay = {
        Type: Type,
        registerFunction: function(func, functionCode) {
            registeredFunctions[functionCode] = func;
        }
    };

    class TextSecureError extends Error {}

    function ReplayableError(options) {
        options = options || {};
        this.name         = options.name || 'ReplayableError';
        this.functionCode = options.functionCode;
        this.args         = options.args;
    }
    ReplayableError.prototype = new TextSecureError();
    ReplayableError.prototype.constructor = ReplayableError;

    ReplayableError.prototype.replay = function() {
        return registeredFunctions[this.functionCode].apply(this, this.args);
    };

    function IncomingIdentityKeyError(number, message, key) {
        ReplayableError.call(this, {
            functionCode: Type.INIT_SESSION,
            args: [number, message]
        });
        this.number = number.split('.')[0];
        this.name = 'IncomingIdentityKeyError';
        this.message = "The identity of " + this.number + " has changed.";
        this.identityKey = key;
    }
    IncomingIdentityKeyError.prototype = new ReplayableError();
    IncomingIdentityKeyError.prototype.constructor = IncomingIdentityKeyError;

    function OutgoingIdentityKeyError(number, message, timestamp, identityKey) {
        ReplayableError.call(this, {
            functionCode: Type.ENCRYPT_MESSAGE,
            args: [number, message, timestamp]
        });
        this.number = number.split('.')[0];
        this.name = 'OutgoingIdentityKeyError';
        this.message = "The identity of " + this.number + " has changed.";
        this.identityKey = identityKey;
    }
    OutgoingIdentityKeyError.prototype = new ReplayableError();
    OutgoingIdentityKeyError.prototype.constructor = OutgoingIdentityKeyError;

    function OutgoingMessageError(number, message, timestamp, httpError) {
        ReplayableError.call(this, {
            functionCode: Type.ENCRYPT_MESSAGE,
            args: [number, message, timestamp]
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

    function SendMessageError(number, jsonData, httpError, timestamp) {
        ReplayableError.call(this, {
            functionCode: Type.TRANSMIT_MESSAGE,
            args: [number, jsonData, timestamp]
        });
        this.name = 'SendMessageError';
        this.number = number;
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

    function UnregisteredUserError(number, httpError) {
        this.name = 'UnregisteredUserError';
        this.number = number;
        this.code = httpError.code;
        this.message = httpError.message;
        this.stack = httpError.stack;
    }
    UnregisteredUserError.prototype = new TextSecureError();
    UnregisteredUserError.prototype.constructor = UnregisteredUserError;

    class ProtocolError extends TextSecureError {
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

    class NetworkError extends TextSecureError {
        constructor(a, b, c) {
            super(a, b, c);
            this.name = 'NetworkError';
        }
    }

    textsecure.UnregisteredUserError = UnregisteredUserError;
    textsecure.IncomingIdentityKeyError = IncomingIdentityKeyError;
    textsecure.OutgoingIdentityKeyError = OutgoingIdentityKeyError;
    textsecure.TextSecureError = TextSecureError;
    textsecure.ReplayableError = ReplayableError;
    textsecure.OutgoingMessageError = OutgoingMessageError;
    textsecure.MessageError = MessageError;
    textsecure.SendMessageError = SendMessageError;
    textsecure.ProtocolError = ProtocolError;
    textsecure.NetworkError = NetworkError;
})();
