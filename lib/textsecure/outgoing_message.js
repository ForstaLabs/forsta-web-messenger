/*
 * vim: ts=4:sw=4:expandtab
 */
function OutgoingMessage(server, timestamp, numbers, message, callback) {
    this.server = server;
    this.timestamp = timestamp;
    this.numbers = numbers;
    this.message = message; // DataMessage or ContentMessage proto
    this.callback = callback;
    this.legacy = (message instanceof textsecure.protobuf.DataMessage);
    this.numbersCompleted = 0;
    this.errors = [];
    this.successfulNumbers = [];
}

OutgoingMessage.prototype = {
    constructor: OutgoingMessage,

    numberCompleted: function() {
        this.numbersCompleted++;
        if (this.numbersCompleted >= this.numbers.length) {
            this.callback({successfulNumbers: this.successfulNumbers, errors: this.errors});
        }
    },

    registerError: function(number, reason, error) {
        if (!error || error.name === 'HTTPError' && error.code !== 404) {
            error = new textsecure.OutgoingMessageError(number, this.message.toArrayBuffer(), this.timestamp, error);
        }

        error.number = number;
        error.reason = reason;
        this.errors[this.errors.length] = error;
        this.numberCompleted();
    },

    reloadDevicesAndSend: function(number, recurse) {
        return function() {
            return textsecure.store.getDeviceIds(number).then(function(deviceIds) {
                if (deviceIds.length == 0) {
                    return this.registerError(number, "Got empty device list when loading device keys", null);
                }
                return this.doSendMessage(number, deviceIds, recurse);
            }.bind(this));
        }.bind(this);
    },

    getKeysForNumber: function(number, updateDevices) {
        var handleResult = function(response) {
            return Promise.all(response.devices.map(function(device) {
                device.identityKey = response.identityKey;
                if (updateDevices === undefined || updateDevices.indexOf(device.deviceId) > -1) {
                    var address = new libsignal.SignalProtocolAddress(number, device.deviceId);
                    var builder = new libsignal.SessionBuilder(textsecure.store, address);
                    return builder.processPreKey(device).catch(function(error) {
                        if (error.message === "Identity key changed") {
                            error = new textsecure.OutgoingIdentityKeyError(
                                number, this.message.toArrayBuffer(),
                                this.timestamp, device.identityKey);
                            this.registerError(number, "Identity key changed", error);
                        }
                        throw error;
                    }.bind(this));
                }
            }.bind(this)));
        }.bind(this);

        if (updateDevices === undefined) {
            return this.server.getKeysForNumber(number).then(handleResult);
        } else {
            var promise = Promise.resolve();
            updateDevices.forEach(function(device) {
                promise = promise.then(function() {
                    return this.server.getKeysForNumber(number, device).then(handleResult).catch(function(e) {
                        if (e.name === 'HTTPError' && e.code === 404 && device !== 1) {
                            return this.removeDeviceIdsForNumber(number, [device]);
                        } else {
                            throw e;
                        }
                    }.bind(this));
                }.bind(this));
            }.bind(this));

            return promise;
        }
    },

    transmitMessage: function(number, jsonData, timestamp) {
        return this.server.sendMessages(number, jsonData, timestamp).catch(function(e) {
            if (e.name === 'HTTPError' && (e.code !== 409 && e.code !== 410)) {
                // 409 and 410 should bubble and be handled by doSendMessage
                // 404 should throw UnregisteredUserError
                // all other network errors can be retried later.
                if (e.code === 404) {
                    throw new textsecure.UnregisteredUserError(number, e);
                }
                throw new textsecure.SendMessageNetworkError(number, jsonData, e, timestamp);
            }
            throw e;
        });
    },

    getPaddedMessageLength: function(messageLength) {
        var messageLengthWithTerminator = messageLength + 1;
        var messagePartCount            = Math.floor(messageLengthWithTerminator / 160);

        if (messageLengthWithTerminator % 160 !== 0) {
            messagePartCount++;
        }

        return messagePartCount * 160;
    },

    doSendMessage: function(number, deviceIds, recurse) {
        var ciphers = {};
        var plaintext = this.message.toArrayBuffer();
        var paddedPlaintext = new Uint8Array(
            this.getPaddedMessageLength(plaintext.byteLength + 1) - 1
        );
        paddedPlaintext.set(new Uint8Array(plaintext));
        paddedPlaintext[plaintext.byteLength] = 0x80;

        return Promise.all(deviceIds.map(function(deviceId) {
            var address = new libsignal.SignalProtocolAddress(number, deviceId);
            var sessionCipher =  new libsignal.SessionCipher(textsecure.store, address);
            ciphers[address.getDeviceId()] = sessionCipher;
            return this.encryptToDevice(address, paddedPlaintext, sessionCipher);
        }.bind(this))).then(function(jsonData) {
            return this.transmitMessage(number, jsonData, this.timestamp).then(function() {
                this.successfulNumbers[this.successfulNumbers.length] = number;
                this.numberCompleted();
            }.bind(this));
        }.bind(this)).catch(function(error) {
            if (error instanceof Error && error.name == "HTTPError" && (error.code == 410 || error.code == 409)) {
                if (!recurse)
                    return this.registerError(number, "Hit retry limit attempting to reload device list", error);

                var p;
                if (error.code == 409) {
                    p = this.removeDeviceIdsForNumber(number, error.response.extraDevices);
                } else {
                    p = Promise.all(error.response.staleDevices.map(function(deviceId) {
                        return ciphers[deviceId].closeOpenSessionForDevice();
                    }));
                }

                return p.then(function() {
                    var resetDevices = ((error.code == 410) ? error.response.staleDevices : error.response.missingDevices);
                    return this.getKeysForNumber(number, resetDevices)
                        .then(this.reloadDevicesAndSend(number, (error.code == 409)))
                        .catch(function(error) {
                            this.registerError(number, "Failed to reload device keys", error);
                        }.bind(this));
                }.bind(this));
            } else {
                this.registerError(number, "Failed to create or send message", error);
            }
        }.bind(this));
    },

    encryptToDevice: function(address, plaintext, sessionCipher) {
        return sessionCipher.encrypt(plaintext).then(function(ciphertext) {
            return this.toJSON(address, ciphertext);
        }.bind(this));
    },

    toJSON: function(address, encryptedMsg) {
        var json = {
            type                      : encryptedMsg.type,
            destinationDeviceId       : address.getDeviceId(),
            destinationRegistrationId : encryptedMsg.registrationId
        };

        var content = btoa(encryptedMsg.body);
        if (this.legacy) {
            json.body = content;
        } else {
            json.content = content;
        }

        return json;
    },

    getStaleDeviceIdsForNumber: function(number) {
        return textsecure.store.getDeviceIds(number).then(function(deviceIds) {
            if (deviceIds.length === 0) {
                return [1];
            }
            var updateDevices = [];
            return Promise.all(deviceIds.map(function(deviceId) {
                var address = new libsignal.SignalProtocolAddress(number, deviceId);
                var sessionCipher = new libsignal.SessionCipher(textsecure.store, address);
                return sessionCipher.hasOpenSession().then(function(hasSession) {
                    if (!hasSession) {
                        updateDevices.push(deviceId);
                    }
                });
            })).then(function() {
                return updateDevices;
            });
        });
    },

    removeDeviceIdsForNumber: function(number, deviceIdsToRemove) {
        var promise = Promise.resolve();
        for (var j in deviceIdsToRemove) {
            promise = promise.then(function() {
                var encodedNumber = number + "." + deviceIdsToRemove[j];
                return textsecure.store.removeSession(encodedNumber);
            });
        }
        return promise;
    },

    sendToNumber: function(number) {
        return this.getStaleDeviceIdsForNumber(number).then(function(updateDevices) {
            return this.getKeysForNumber(number, updateDevices)
                .then(this.reloadDevicesAndSend(number, true))
                .catch(function(error) {
                    this.registerError(number, "Failed to retrieve new device keys for number " + number, error);
                }.bind(this));
        }.bind(this));
    }
};
