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
        404: "Address is not registered",
        413: "Server rate limit exceeded",
        417: "Address already registered"
    };

    ns.TextSecureServer = function(url, username, password, addr, deviceId, attachmentsUrl) {
        if (typeof url !== 'string') {
            throw new Error('Invalid server url');
        }
        this.url = url;
        this.username = username;
        this.password = password;
        this.addr = addr;
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

        fetch: async function(param) {
            if (!param.urlParameters) {
                param.urlParameters = '';
            }
            const path = URL_CALLS[param.call] + param.urlParameters;
            const headers = new Headers();
            if (this.username && this.password) {
                headers.set('Authorization', authHeader(this.username, this.password));
            }
            const body = param.jsonData && textsecure.utils.jsonThing(param.jsonData);
            if (body) {
                headers.set('Content-Type', 'application/json; charset=utf-8');
            }
            const resp = await fetch(`${this.url}/${path}`, {
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

        requestVerificationSMS: function(phone) {
            return this.fetch({
                call: 'accounts',
                urlParameters: '/sms/code/' + phone,
            });
        },

        requestVerificationVoice: function(phone) {
            return this.fetch({
                call: 'accounts',
                urlParameters: '/voice/code/' + phone,
            });
        },

        confirmCode: function(addr, code, password, signaling_key, registrationId, deviceName) {
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
                schema = { deviceId: 'addr' };
            } else {
                call = 'accounts';
                urlPrefix = '/code/';
            }
            this.username = addr;
            this.password = password;
            return this.fetch({
                call,
                httpType: 'PUT',
                urlParameters: urlPrefix + code,
                jsonData,
                validateResponse: schema
            });
        },

        getDevices: function() {
            return this.fetch({call: 'devices'});
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
            return this.fetch({
                call: 'keys',
                httpType: 'PUT',
                jsonData: keys,
            });
        },

        getMyKeys: async function(addr, deviceId) {
            const res = await this.fetch({
                call: 'keys',
                validateResponse: {count: 'number'}
            });
            return res.count;
        },

        getKeysForAddr: async function(addr, deviceId) {
            if (deviceId === undefined) {
                deviceId = "*";
            }
            const res = await this.fetch({
                call: 'keys',
                urlParameters: "/" + addr + "/" + deviceId,
                validateResponse: {identityKey: 'string', devices: 'object'}
            });
            if (res.devices.constructor !== Array) {
                throw new Error("Invalid response");
            }
            res.identityKey = StringView.base64ToBytes(res.identityKey);
            res.devices.forEach(device => {
                if (!validateResponse(device, {signedPreKey: 'object', preKey: 'object'}) ||
                    !validateResponse(device.signedPreKey, {publicKey: 'string', signature: 'string'}) ||
                    !validateResponse(device.preKey, {publicKey: 'string'})) {
                    throw new Error("Invalid response");
                }
                device.signedPreKey.publicKey = StringView.base64ToBytes(device.signedPreKey.publicKey);
                device.signedPreKey.signature = StringView.base64ToBytes(device.signedPreKey.signature);
                device.preKey.publicKey = StringView.base64ToBytes(device.preKey.publicKey);
            });
            return res;
        },

        sendMessages: function(destination, messageArray, timestamp) {
            var jsonData = {
                messages: messageArray,
                timestamp: timestamp
            };
            return this.fetch({
                call: 'messages',
                httpType: 'PUT',
                urlParameters: '/' + destination,
                jsonData
            });
        },

        getAttachment: async function(id) {
            const response = await this.fetch({
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
            if (!attachment.ok) {
                const msg = await attachment.text();
                console.error("Download attachement error:", msg);
                throw new Error('Download Attachment Error: ' + msg);
            }
            return await attachment.arrayBuffer();
        },

        putAttachment: async function(body) {
            const ptrResp = await this.fetch({call: 'attachment'});
            // Extract the id as a string from the location url
            // (workaround for ids too large for Javascript numbers)
            const match = ptrResp.location.match(this.attachment_id_regex);
            if (!match) {
                console.error('Invalid attachment url for outgoing message',
                              ptrResp.location);
                throw new Error('Received invalid attachment url');
            }
            const headers = new Headers({
                'Content-Type': 'application/octet-stream',
            });
            const dataResp = await fetch(ptrResp.location, {
                method: "PUT",
                headers,
                body
            });
            if (!dataResp.ok) {
                const msg = await dataResp.text();
                console.error("Upload attachement error:", msg);
                throw new Error('Upload Attachment Error: ' + msg);
            }
            return match[1];
        },

        getMessageSocket: function() {
            const url = [
                this.url.replace('https://', 'wss://').replace('http://', 'ws://'),
                '/v1/websocket/?login=' + encodeURIComponent(this.username),
                '&password=' + encodeURIComponent(this.password),
                '&agent=OWD'].join('');
            return new WebSocket(url);
        },

        getProvisioningSocket: function () {
            const url = this.url.replace('https://', 'wss://').replace('http://', 'ws://') +
                                         '/v1/websocket/provisioning/?agent=OWD';
            return new WebSocket(url);
        },

        /* The GCM reg ID configures the data needed for the PushServer to wake us up
         * if this page is not active.  I.e. from our ServiceWorker. */
        updateGcmRegistrationId: async function(gcm_reg_id) {
            return await this.fetch({
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
