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
            throw new TypeError('Invalid server url');
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

        request: async function(param) {
            if (!param.urlParameters) {
                param.urlParameters = '';
            }
            const path = URL_CALLS[param.call] + param.urlParameters;
            const headers = new Headers();
            if (param.username && param.password) {
                headers.set('Authorization', authHeader(param.username, param.password));
            }
            let resp;
            try {
                resp = await this.fetch(path, {
                    method: param.httpType || 'GET',
                    json: param.jsonData,
                    headers
                });
            } catch(e) {
                /* Fetch throws a very boring TypeError, throw something better.. */
                throw new textsecure.NetworkError(`${e.message}: ${param.call}`);
            }
            let resp_content;
            if ((resp.headers.get('content-type') || '').startsWith('application/json')) {
                resp_content = await resp.json();
            } else {
                resp_content = await resp.text();
            }
            if (!resp.ok) {
                const e = new textsecure.ProtocolError(resp.status, resp_content);
                if (HTTP_MESSAGES.hasOwnProperty(e.code)) {
                    e.message = HTTP_MESSAGES[e.code];
                } else {
                    e.message = `Status code: ${e.code}`;
                }
                throw e;
            }
            if (resp.status !== 204) {
                if (param.validateResponse &&
                    !validateResponse(resp_content, param.validateResponse)) {
                    throw new textsecure.ProtocolError(resp.status, resp_content);
                }
                return resp_content;
            }
        },

        fetch: async function(urn, options) {
            /* Thin wrapper around global.fetch to augment json and auth support. */
            options = options || {};
            options.headers = options.headers || new Headers();
            if (!options.headers.has('Authorization')) {
                if (this.username && this.password) {
                    options.headers.set('Authorization', authHeader(this.username, this.password));
                }
            }
            const body = options.json && textsecure.utils.jsonThing(options.json);
            if (body) {
                options.headers.set('Content-Type', 'application/json; charset=utf-8');
                options.body = body;
            }
            return await fetch(`${this.url}/${urn.replace(/^\//, '')}`, options);
        },

        requestVerificationSMS: function(phone) {
            console.warn("DEPRECATED");
            return this.request({
                call: 'accounts',
                urlParameters: '/sms/code/' + phone,
            });
        },

        requestVerificationVoice: function(phone) {
            console.warn("DEPRECATED");
            return this.request({
                call: 'accounts',
                urlParameters: '/voice/code/' + phone,
            });
        },

        createAccount: async function(info) {
            console.info("Creating account:", info.addr);
            const json = {
                signalingKey: btoa(getString(info.signalingKey)),
                supportsSms: false,
                fetchesMessages: true,
                registrationId: info.registrationId,
                name: info.name,
                password: info.password
            };
            const response = await F.ccsm.fetchResource('/v1/provision-proxy/', {
                method: 'PUT',
                json,
            });
            Object.assign(info, response);
            /* Save the new creds to our instance for future TSS API calls. */
            this.username = info.username = `${info.addr}.${info.deviceId}`;
            this.password = info.password;
            return info;
        },

        addDevice: async function(code, info) {
            if (!info.password || !info.addr || !info.signalingKey) {
                throw new ReferenceError("Missing Key(s)");
            }
            console.info("Adding device to:", info.addr);
            const jsonData = {
                signalingKey: btoa(getString(info.signalingKey)),
                supportsSms: false,
                fetchesMessages: true,
                registrationId: info.registrationId,
                name: info.name
            };
            const response = await this.request({
                httpType: 'PUT',
                call: 'devices',
                urlParameters: '/' + code,
                jsonData,
                username: info.addr,
                password: info.password,
                validateResponse: {deviceId: 'number'}
            });
            Object.assign(info, response);
            /* Save the new creds to our instance for future TSS API calls. */
            this.username = info.username = `${info.addr}.${info.deviceId}`;
            this.password = info.password;
            return info;
        },

        getDevices: async function() {
            const data = await this.request({call: 'devices'});
            return data && data.devices;
        },

        registerKeys: function(genKeys) {
            var jsonData = {};
            jsonData.identityKey = btoa(getString(genKeys.identityKey));
            jsonData.signedPreKey = {
                keyId: genKeys.signedPreKey.keyId,
                publicKey: btoa(getString(genKeys.signedPreKey.publicKey)),
                signature: btoa(getString(genKeys.signedPreKey.signature))
            };
            jsonData.preKeys = [];
            var j = 0;
            for (var i in genKeys.preKeys) {
                jsonData.preKeys[j++] = {
                    keyId: genKeys.preKeys[i].keyId,
                    publicKey: btoa(getString(genKeys.preKeys[i].publicKey))
                };
            }
            // Newer generation servers don't expect this BTW.
            jsonData.lastResortKey = {
                keyId: genKeys.lastResortKey.keyId,
                publicKey: btoa(getString(genKeys.lastResortKey.publicKey))
            };
            return this.request({
                call: 'keys',
                httpType: 'PUT',
                jsonData
            });
        },

        getMyKeys: async function(addr, deviceId) {
            const res = await this.request({
                call: 'keys',
                validateResponse: {count: 'number'}
            });
            return res.count;
        },

        getKeysForAddr: async function(addr, deviceId) {
            if (deviceId === undefined) {
                deviceId = "*";
            }
            const res = await this.request({
                call: 'keys',
                urlParameters: "/" + addr + "/" + deviceId,
                validateResponse: {identityKey: 'string', devices: 'object'}
            });
            if (res.devices.constructor !== Array) {
                throw new TypeError("Invalid response");
            }
            res.identityKey = StringView.base64ToBytes(res.identityKey);
            res.devices.forEach(device => {
                if (!validateResponse(device, {signedPreKey: 'object', preKey: 'object'}) ||
                    !validateResponse(device.signedPreKey, {publicKey: 'string', signature: 'string'}) ||
                    !validateResponse(device.preKey, {publicKey: 'string'})) {
                    throw new TypeError("Invalid response");
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
            return this.request({
                call: 'messages',
                httpType: 'PUT',
                urlParameters: '/' + destination,
                jsonData
            });
        },

        getAttachment: async function(id) {
            // XXX Build in retry handling...
            const response = await this.request({
                call: 'attachment',
                urlParameters: '/' + id,
                validateResponse: {location: 'string'}
            });
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
            // XXX Build in retry handling...
            const ptrResp = await this.request({call: 'attachment'});
            // Extract the id as a string from the location url
            // (workaround for ids too large for Javascript numbers)
            //  XXX find way around having to know the S3 url.
            const match = ptrResp.location.match(this.attachment_id_regex);
            if (!match) {
                console.error('Invalid attachment url for outgoing message',
                              ptrResp.location);
                throw new TypeError('Received invalid attachment url');
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

        getMessageWebSocketURL: function() {
            return [
                this.url.replace('https://', 'wss://').replace('http://', 'ws://'),
                '/v1/websocket/?login=', encodeURIComponent(this.username),
                '&password=', encodeURIComponent(this.password)].join('');
        },

        getProvisioningWebSocketURL: function () {
            return this.url.replace('https://', 'wss://').replace('http://', 'ws://') +
                                    '/v1/websocket/provisioning/';
        },

        /* The GCM reg ID configures the data needed for the PushServer to wake us up
         * if this page is not active.  I.e. from our ServiceWorker. */
        updateGcmRegistrationId: async function(gcm_reg_id) {
            return await this.request({
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
