// vim: ts=4:sw=4:expandtab


(function () {
    'use strict';

    self.F = self.F || {};

    self.F.OutgoingMessage = class OutgoingMessage {

        constructor(server, timestamp, message) {
            console.assert(message instanceof textsecure.protobuf.Content);
            this.server = server;
            this.timestamp = timestamp;
            this.message = message;
            this.sent = [];
            this.errors = [];
            this.created = Date.now();
            this._listeners = {};
        }

        on(event, callback) {
            let handlers = this._listeners[event];
            if (!handlers) {
                handlers = this._listeners[event] = [];
            }
            handlers.push(callback);
        }

        async emit(event) {
            const handlers = this._listeners[event];
            if (!handlers) {
                return;
            }
            const args = Array.from(arguments).slice(1);
            for (const callback of handlers) {
                try {
                    callback.apply(this, args);
                } catch(e) {
                    console.error("Event callback error:", e);
                }
            }
        }

        emitError(addr, reason, error) {
            if (!error || error.name === 'HTTPError' && error.code !== 404) {
                error = new textsecure.OutgoingMessageError(addr, this.message.toArrayBuffer(),
                                                            this.timestamp, error);
            }
            error.addr = addr;
            error.reason = reason;
            const entry = {
                timestamp: Date.now(),
                error
            };
            this.errors.push(entry);
            this.emit('error', entry);
        }

        emitSent(addr) {
            const entry = {
                timestamp: Date.now(),
                addr
            };
            this.sent.push(entry);
            this.emit('sent', entry);
        }

        reloadDevicesAndSend(addr, recurse) {
            return async function() {
                const deviceIds = await textsecure.store.getDeviceIds(addr);
                if (!deviceIds.length) {
                    const ourAddr = await textsecure.store.getState('addr');
                    if (addr === ourAddr) {
                        this.emitSent(addr);
                    } else {
                        return this.emitError(addr, "Got empty device list when loading device keys", null);
                    }
                }
                return await this.doSendMessage(addr, deviceIds, recurse, {});
            }.bind(this);
        }

        getKeysForAddr(addr, updateDevices) {
            var handleResult = function(response) {
                return Promise.all(response.devices.map(function(device) {
                    device.identityKey = response.identityKey;
                    if (updateDevices === undefined || updateDevices.indexOf(device.deviceId) > -1) {
                        var address = new libsignal.SignalProtocolAddress(addr, device.deviceId);
                        var builder = new libsignal.SessionBuilder(textsecure.store, address);
                        return builder.processPreKey(device).catch(function(error) {
                            if (error.message === "Identity key changed") {
                                error = new textsecure.OutgoingIdentityKeyError(addr,
                                    this.message.toArrayBuffer(), this.timestamp, device.identityKey);
                                this.emitError(addr, "Identity key changed", error);
                            }
                            throw error;
                        }.bind(this));
                    }
                }.bind(this)));
            }.bind(this);
            if (updateDevices === undefined) {
                return this.server.getKeysForAddr(addr).then(handleResult);
            } else {
                var promise = Promise.resolve();
                updateDevices.forEach(function(device) {
                    promise = promise.then(function() {
                        return this.server.getKeysForAddr(addr, device).then(handleResult).catch(function(e) {
                            if (e.name === 'HTTPError' && e.code === 404 && device !== 1) {
                                return this.removeDeviceIdsForAddr(addr, [device]);
                            } else {
                                throw e;
                            }
                        }.bind(this));
                    }.bind(this));
                }.bind(this));
                return promise;
            }
        }

        transmitMessage(addr, jsonData, timestamp) {
            return this.server.sendMessages(addr, jsonData, timestamp).catch(function(e) {
                if (e.name === 'HTTPError' && (e.code !== 409 && e.code !== 410)) {
                    // 409 and 410 should bubble and be handled by doSendMessage
                    // 404 should throw UnregisteredUserError
                    // all other network errors can be retried later.
                    if (e.code === 404) {
                        throw new textsecure.UnregisteredUserError(addr, e);
                    }
                    throw new textsecure.SendMessageNetworkError(addr, jsonData, e, timestamp);
                }
                throw e;
            });
        }

        getPaddedMessageLength(messageLength) {
            var messageLengthWithTerminator = messageLength + 1;
            var messagePartCount = Math.floor(messageLengthWithTerminator / 160);
            if (messageLengthWithTerminator % 160 !== 0) {
                messagePartCount++;
            }
            return messagePartCount * 160;
        }

        doSendMessage(addr, deviceIds, recurse) {
            var ciphers = {};
            var plaintext = this.message.toArrayBuffer();
            var paddedPlaintext = new Uint8Array(
                this.getPaddedMessageLength(plaintext.byteLength + 1) - 1
            );
            paddedPlaintext.set(new Uint8Array(plaintext));
            paddedPlaintext[plaintext.byteLength] = 0x80;
            return Promise.all(deviceIds.map(function(deviceId) {
                var address = new libsignal.SignalProtocolAddress(addr, deviceId);
                var sessionCipher = new libsignal.SessionCipher(textsecure.store, address);
                ciphers[address.getDeviceId()] = sessionCipher;
                return this.encryptToDevice(address, paddedPlaintext, sessionCipher);
            }.bind(this))).then(function(jsonData) {
                return this.transmitMessage(addr, jsonData, this.timestamp).then(function() {
                    this.emitSent(addr);
                }.bind(this));
            }.bind(this)).catch(function(error) {
                if (error instanceof Error && error.name == "HTTPError" && (error.code == 410 || error.code == 409)) {
                    if (!recurse)
                        return this.emitError(addr, "Hit retry limit attempting to reload device list", error);
                    var p;
                    if (error.code == 409) {
                        p = this.removeDeviceIdsForAddr(addr, error.response.extraDevices);
                    } else {
                        p = Promise.all(error.response.staleDevices.map(function(deviceId) {
                            return ciphers[deviceId].closeOpenSessionForDevice();
                        }));
                    }
                    return p.then(function() {
                        var resetDevices = ((error.code == 410) ? error.response.staleDevices : error.response.missingDevices);
                        return this.getKeysForAddr(addr, resetDevices)
                            .then(this.reloadDevicesAndSend(addr, (error.code == 409)))
                            .catch(function(error) {
                                this.emitError(addr, "Failed to reload device keys", error);
                            }.bind(this));
                    }.bind(this));
                } else {
                    this.emitError(addr, "Failed to create or send message", error);
                }
            }.bind(this));
        }

        encryptToDevice(address, plaintext, sessionCipher) {
            return sessionCipher.encrypt(plaintext).then(function(ciphertext) {
                return this.toJSON(address, ciphertext);
            }.bind(this));
        }

        toJSON(address, encryptedMsg) {
            return {
                type: encryptedMsg.type,
                destinationDeviceId: address.getDeviceId(),
                destinationRegistrationId: encryptedMsg.registrationId,
                content: btoa(encryptedMsg.body)
            };
        }

        async getStaleDeviceIdsForAddr(addr) {
            const deviceIds = await textsecure.store.getDeviceIds(addr);
            if (!deviceIds.length) {
                const ourAddr = await textsecure.store.getState('addr');
                if (addr !== ourAddr) {
                    deviceIds.push(1); // Just try ID 1 first; The server will correct us as needed.
                }
            }
            const updateDevices = [];
            for (const id of deviceIds) {
                const address = new libsignal.SignalProtocolAddress(addr, id);
                const sessionCipher = new libsignal.SessionCipher(textsecure.store, address);
                if (!(await sessionCipher.hasOpenSession())) {
                    updateDevices.push(id);
                }
            }
            return updateDevices;
        }

        removeDeviceIdsForAddr(addr, deviceIdsToRemove) {
            var promise = Promise.resolve();
            for (var j in deviceIdsToRemove) {
                promise = promise.then(function() {
                    var encodedAddr = addr + "." + deviceIdsToRemove[j];
                    return textsecure.store.removeSession(encodedAddr);
                });
            }
            return promise;
        }

        async sendToAddr(addr) {
            let updateDevices;
            try {
                updateDevices = await this.getStaleDeviceIdsForAddr(addr);
            } catch (error) {
                this.emitError(addr, "Failed to get device ids for address " + addr, error);
            }
            try {
                await this.getKeysForAddr(addr, updateDevices);
            } catch(error) {
                this.emitError(addr, "Failed to retrieve new device keys for address " + addr, error);
            }
            try {
                await this.reloadDevicesAndSend(addr, true)();
            } catch(error) {
                this.emitError(addr, "Failed to send to address " + addr, error);
            }
        }
    };
})();
