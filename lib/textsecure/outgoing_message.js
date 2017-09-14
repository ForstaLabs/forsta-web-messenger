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
            if (!error || error instanceof textsecure.ProtocolError && error.code !== 404) {
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

        async reloadDevicesAndSend(addr, recurse) {
            const deviceIds = await textsecure.store.getDeviceIds(addr);
            if (!deviceIds.length) {
                const ourAddr = await textsecure.store.getState('addr');
                if (addr === ourAddr) {
                    this.emitSent(addr);
                } else {
                    console.warn("Unregistered address:", addr);
                    return;
                }
            }
            return await this.doSendMessage(addr, deviceIds, recurse, {});
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
                            if (e instanceof textsecure.ProtocolError && e.code === 404 && device !== 1) {
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

        async transmitMessage(addr, jsonData, timestamp) {
            try {
                return await this.server.sendMessages(addr, jsonData, timestamp);
            } catch(e) {
                if (e instanceof textsecure.ProtocolError && (e.code !== 409 && e.code !== 410)) {
                    // 409 and 410 should bubble and be handled by doSendMessage
                    // 404 should throw UnregisteredUserError
                    // all other network errors can be retried later.
                    if (e.code === 404) {
                        throw new textsecure.UnregisteredUserError(addr, e);
                    }
                    throw new textsecure.SendMessageError(addr, jsonData, e, timestamp);
                }
                throw e;
            }
        }

        getPaddedMessageLength(messageLength) {
            var messageLengthWithTerminator = messageLength + 1;
            var messagePartCount = Math.floor(messageLengthWithTerminator / 160);
            if (messageLengthWithTerminator % 160 !== 0) {
                messagePartCount++;
            }
            return messagePartCount * 160;
        }

        async doSendMessage(addr, deviceIds, recurse) {
            const ciphers = {};
            const plaintext = this.message.toArrayBuffer();
            const paddedPlaintext = new Uint8Array(
                this.getPaddedMessageLength(plaintext.byteLength + 1) - 1
            );
            paddedPlaintext.set(new Uint8Array(plaintext));
            paddedPlaintext[plaintext.byteLength] = 0x80;
            let messages;
            try {
                messages = await Promise.all(deviceIds.map(id => {
                    const address = new libsignal.SignalProtocolAddress(addr, id);
                    const sessionCipher = new libsignal.SessionCipher(textsecure.store, address);
                    ciphers[address.getDeviceId()] = sessionCipher;
                    return this.encryptToDevice(address, paddedPlaintext, sessionCipher);
                }));
            } catch(e) {
                this.emitError(addr, "Failed to create message", e);
                return;
            }
            try {
                await this.transmitMessage(addr, messages, this.timestamp);
            } catch(e) {
                if (e instanceof textsecure.ProtocolError && (e.code === 410 || e.code === 409)) {
                    if (!recurse) {
                        this.emitError(addr, "Hit retry limit attempting to reload device list", e);
                        return;
                    }
                    if (e.code === 409) {
                        await this.removeDeviceIdsForAddr(addr, e.response.extraDevices);
                    } else {
                        await Promise.all(e.response.staleDevices.map(x =>
                            ciphers[x].closeOpenSessionForDevice()));
                    }
                    const resetDevices = e.code === 410 ? e.response.staleDevices : e.response.missingDevices;
                    await this.getKeysForAddr(addr, resetDevices);
                    try {
                        await this.reloadDevicesAndSend(addr, (e.code === 409));
                    } catch(e) {
                        this.emitError(addr, "Failed to reload device keys", e);
                        return;
                    }
                } else {
                    this.emitError(addr, "Failed to send message", e);
                    return;
                }
            }
            this.emitSent(addr);
        }

        async encryptToDevice(address, plaintext, sessionCipher) {
            const ciphertext = await sessionCipher.encrypt(plaintext);
            return this.toJSON(address, ciphertext);
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

        async removeDeviceIdsForAddr(addr, deviceIdsToRemove) {
            for (const id of deviceIdsToRemove) {
                const encodedAddr = addr + "." + id;
                await textsecure.store.removeSession(encodedAddr);
            }
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
                await this.reloadDevicesAndSend(addr, true);
            } catch(error) {
                this.emitError(addr, "Failed to send to address " + addr, error);
            }
        }
    };
})();
