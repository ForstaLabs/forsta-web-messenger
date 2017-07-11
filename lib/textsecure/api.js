// vim: ts=4:sw=4:expandtab
/* global getString, StringView */

(function() {
    'use strict';

    const ns = self.textsecure = self.textsecure || {};

    function validateResponse(response, schema) {
        try {
            for (var i in schema) {
                switch (schema[i]) {
                    case 'object':
                    case 'string':
                    case 'number':
                        if (typeof response[i] !== schema[i]) {
                            return false;
                        }
                        break;
                }
            }
        } catch(ex) {
            return false;
        }
        return true;
    }

    function authHeader(username, password) {
        return "Basic " + btoa(getString(username) + ":" + getString(password));
    }

    // Promise-based async xhr routine
    function promise_ajax(url, options) {
        return new Promise(function (resolve, reject) {
            if (!url) {
                url = options.host + ':' + options.port + '/' + options.path;
            }
            var xhr = new XMLHttpRequest();
            xhr.open(options.type, url, true /*async*/);
            if ( options.responseType ) {
                xhr[ 'responseType' ] = options.responseType;
            }
            if (options.user && options.password) {
                xhr.setRequestHeader("Authorization", authHeader(options.user, options.password));
            }
            if (options.contentType) {
                xhr.setRequestHeader( "Content-Type", options.contentType );
            }
            xhr.setRequestHeader( 'X-Signal-Agent', 'OWD' );
            xhr.onload = function() {
                var result = xhr.response;
                if ( (!xhr.responseType || xhr.responseType === "text") &&
                        typeof xhr.responseText === "string" ) {
                    result = xhr.responseText;
                }
                if (options.dataType === 'json') {
                    try {
                        result = JSON.parse(xhr.responseText + '');
                    } catch(e) {/*no-pragma*/}
                    if (options.validateResponse) {
                        if (!validateResponse(result, options.validateResponse)) {
                            console.error(options.type, url, xhr.status);
                            reject(HTTPError(xhr.status, result, options.stack));
                        }
                    }
                }
                if (0 <= xhr.status && xhr.status < 400) {
                    resolve(result, xhr.status);
                } else {
                    reject(HTTPError(xhr.status, result, options.stack));
                }
            };
            xhr.onerror = function() {
                reject(HTTPError(xhr.status, null, options.stack));
            };
            xhr.send( options.data || null );
        });
    }

    function retry_ajax(url, options, limit, count) {
        count = count || 0;
        limit = limit || 3;
        count++;
        return promise_ajax(url, options).catch(function(e) {
            if (e.name === 'HTTPError' && e.code === -1 && count < limit) {
                return new Promise(function(resolve) {
                    setTimeout(function() {
                        resolve(retry_ajax(url, options, limit, count));
                    }, 1000);
                });
            } else {
                throw e;
            }
        });
    }

    function ajax(url, options) {
        options.stack = new Error().stack; // just in case, save stack here.
        return retry_ajax(url, options);
    }

    function HTTPError(code, response, stack) {
        if (code > 999 || code < 100) {
            code = -1;
        }
        var e = new Error();
        e.name = 'HTTPError';
        e.code = code;
        if (stack) {
            e.stack = stack;
        }
        if (response) {
            e.response = response;
        }
        return e;
    }

    const URL_CALLS = {
        accounts: "v1/accounts",
        devices: "v1/devices",
        keys: "v2/keys",
        messages: "v1/messages",
        attachment: "v1/attachments"
    };

    const HTTP_MESSAGES = {
        401: "Invalid authentication or invalidated registration",
        403: "Invalid code",
        404: "Number is not registered",
        413: "Server rate limit exceeded",
        417: "Number already registered"
    };

    ns.TextSecureServer = function(url, port, username, password, number, deviceId,
                                   attachmentsUrl) {
        if (typeof url !== 'string') {
            throw new Error('Invalid server url');
        }
        this.url = url;
        this.port = port;
        this.username = username;
        this.password = password;
        this.number = number;
        this.deviceId = deviceId;

        this.attachment_id_regex = RegExp("^https://.*/(\\d+)?");
        if (attachmentsUrl) {
            // strip trailing slash (/)
            attachmentsUrl = attachmentsUrl.replace(/\/$/,'');
            // and escape
            attachmentsUrl = attachmentsUrl.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            this.attachmentsUrl = attachmentsUrl;
            this.attachment_id_regex = RegExp("^" + attachmentsUrl + "/(\\d+)?");
        }
    };

    ns.TextSecureServer.prototype = {
        constructor: ns.TextSecureServer,

        getUrl: function() {
            return this.url + ':' + this.port;
        },

        ajax: function(param) {
            return this._fetch(param);
            /*if (!self.XMLHttpRequest || this.USE_FETCH) {
                return this._fetch(param);
            } else {
                return this._xhr(param);
            }*/
        },

        _fetch: async function(param) {
            if (!param.urlParameters) {
                param.urlParameters = '';
            }
            const path = URL_CALLS[param.call] + param.urlParameters;
            const headers = new Headers();
            headers.set('Authorization', authHeader(this.username, this.password));
            const body = param.jsonData && textsecure.utils.jsonThing(param.jsonData);
            if (body) {
                headers.set('Content-Type', 'application/json; charset=utf-8');
            }
            const resp = await fetch(`${this.url}:${this.port}/${path}`, {
                method: param.httpType || 'GET',
                body,
                headers
            });
            let resp_content;
            if (resp.headers.get('content-type') === 'application/json') {
                resp_content = await resp.json();
            } else {
                resp_content = await resp.text();
            }
            if (!resp.ok) {
                const e = HTTPError(resp.status, resp_content);
                if (HTTP_MESSAGES.hasOwnProperty(e.code)) {
                    e.message = HTTP_MESSAGES[e.code];
                } else {
                    e.message = `HTTP Error ${e.code}`;
                }
                throw e;

            }
            if (resp.status !== 204) {
                if (param.validateResponse &&
                    !validateResponse(resp_content, param.validateResponse)) {
                    throw HTTPError(resp.status, resp_content);
                }
                return resp_content;
            }
        },

        _xhr: function(param) {
            if (!param.urlParameters) {
                param.urlParameters = '';
            }
            return ajax(null, {
                    host: this.url,
                    port: this.port,
                    path: URL_CALLS[param.call] + param.urlParameters,
                    type: param.httpType || 'GET',
                    data: param.jsonData && textsecure.utils.jsonThing(param.jsonData),
                    contentType: 'application/json; charset=utf-8',
                    dataType: 'json',
                    user: this.username,
                    password: this.password,
                    validateResponse: param.validateResponse
            }).catch(function(e) {
                if (e.code === 200) {
                    // happens sometimes when we get no response
                    // (TODO: Fix server to return 204? instead)
                    return null;
                }
                if (e.code === -1) {
                    e.message = "Failed to connect to the server";
                } else if (HTTP_MESSAGES.hasOwnProperty(e.code)) {
                    e.message = HTTP_MESSAGES[e.code];
                } else {
                    e.message = `HTTP Error ${e.code}`;
                }
                throw e;
            });
        },

        requestVerificationSMS: function(number) {
            return this.ajax({
                call: 'accounts',
                urlParameters: '/sms/code/' + number,
            });
        },

        requestVerificationVoice: function(number) {
            return this.ajax({
                call: 'accounts',
                urlParameters: '/voice/code/' + number,
            });
        },

        confirmCode: function(number, code, password, signaling_key, registrationId, deviceName) {
            var jsonData = {
                signalingKey: btoa(getString(signaling_key)),
                supportsSms: false,
                fetchesMessages: true,
                registrationId
            };

            var call, urlPrefix, schema;
            if (deviceName) {
                jsonData.name = deviceName;
                call = 'devices';
                urlPrefix = '/';
                schema = { deviceId: 'number' };
            } else {
                call = 'accounts';
                urlPrefix = '/code/';
            }
            this.username = number;
            this.password = password;
            return this.ajax({
                call,
                httpType: 'PUT',
                urlParameters: urlPrefix + code,
                jsonData,
                validateResponse: schema
            });
        },

        getDevices: function(number) {
            return this.ajax({call: 'devices'});
        },

        registerKeys: function(genKeys) {
            var keys = {};
            keys.identityKey = btoa(getString(genKeys.identityKey));
            keys.signedPreKey = {
                keyId: genKeys.signedPreKey.keyId,
                publicKey: btoa(getString(genKeys.signedPreKey.publicKey)),
                signature: btoa(getString(genKeys.signedPreKey.signature))
            };
            keys.preKeys = [];
            var j = 0;
            for (var i in genKeys.preKeys) {
                keys.preKeys[j++] = {
                    keyId: genKeys.preKeys[i].keyId,
                    publicKey: btoa(getString(genKeys.preKeys[i].publicKey))
                };
            }
            // This is just to make the server happy
            // (v2 clients should choke on publicKey)
            keys.lastResortKey = {keyId: 0x7fffFFFF, publicKey: btoa("42")};
            return this.ajax({
                call: 'keys',
                httpType: 'PUT',
                jsonData: keys,
            });
        },

        getMyKeys: function(number, deviceId) {
            return this.ajax({
                call: 'keys',
                validateResponse: {count: 'number'}
            }).then(function(res) {
                return res.count;
            });
        },

        getKeysForNumber: function(number, deviceId) {
            if (deviceId === undefined)
                deviceId = "*";

            return this.ajax({
                call: 'keys',
                urlParameters: "/" + number + "/" + deviceId,
                validateResponse: {identityKey: 'string', devices: 'object'}
            }).then(function(res) {
                if (res.devices.constructor !== Array) {
                    throw new Error("Invalid response");
                }
                res.identityKey = StringView.base64ToBytes(res.identityKey);
                res.devices.forEach(function(device) {
                    if ( !validateResponse(device, {signedPreKey: 'object', preKey: 'object'}) ||
                         !validateResponse(device.signedPreKey, {publicKey: 'string', signature: 'string'}) ||
                         !validateResponse(device.preKey, {publicKey: 'string'})) {
                        throw new Error("Invalid response");
                    }
                    device.signedPreKey.publicKey = StringView.base64ToBytes(device.signedPreKey.publicKey);
                    device.signedPreKey.signature = StringView.base64ToBytes(device.signedPreKey.signature);
                    device.preKey.publicKey = StringView.base64ToBytes(device.preKey.publicKey);
                });
                return res;
            });
        },

        sendMessages: function(destination, messageArray, timestamp) {
            var jsonData = {
                messages: messageArray,
                timestamp: timestamp
            };
            return this.ajax({
                call: 'messages',
                httpType: 'PUT',
                urlParameters: '/' + destination,
                jsonData
            });
        },

        getAttachment: async function(id) {
            const response = await this.ajax({
                call: 'attachment',
                urlParameters: '/' + id,
                validateResponse: {location: 'string'}
            });
            const match = response.location.match(this.attachment_id_regex);
            if (!match) {
                console.error('Invalid attachment url for incoming message',
                              response.location);
                throw new Error('Received invalid attachment url');
            }
            const headers = new Headers({
                'Content-Type': 'application/octet-stream',
            });
            const attachment = await fetch(response.location, {headers});
            return await attachment.arrayBuffer();
        },

        putAttachment: function(encryptedBin) {
            return this.ajax({call: 'attachment'}).then(function(response) {
                // Extract the id as a string from the location url
                // (workaround for ids too large for Javascript numbers)
                var match = response.location.match(this.attachment_id_regex);
                if (!match) {
                    console.error('Invalid attachment url for outgoing message',
                                  response.location);
                    throw new Error('Received invalid attachment url');
                }
                return ajax(response.location, {
                    type: "PUT",
                    contentType: "application/octet-stream",
                    data: encryptedBin,
                    processData: false,
                }).then(function() {
                    return match[1];
                }.bind(this));
            }.bind(this));
        },

        getMessageSocket: function() {
            var url = this.getUrl();
            return new WebSocket(
                url.replace('https://', 'wss://').replace('http://', 'ws://')
                    + '/v1/websocket/?login=' + encodeURIComponent(this.username)
                    + '&password=' + encodeURIComponent(this.password)
                    + '&agent=OWD'
            );
        },

        getProvisioningSocket: function () {
            var url = this.getUrl();
            return new WebSocket(
                url.replace('https://', 'wss://').replace('http://', 'ws://')
                    + '/v1/websocket/provisioning/?agent=OWD'
            );
        },

        /* The GCM reg ID configures the data needed for the PushServer to wake us up
         * if this page is not active.  I.e. from our ServiceWorker. */
        updateGcmRegistrationId: function(gcm_reg_id) {
            return this.ajax({
                call: 'accounts',
                httpType: 'PUT',
                urlParameters: '/gcm',
                jsonData: {
                    gcmRegistrationId: gcm_reg_id
                }
            });
        }
    };
})();
