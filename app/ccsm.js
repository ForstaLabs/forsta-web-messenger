// vim: ts=4:sw=4:expandtab
/* global Raven */

(function() {
    'use strict';

    self.F = self.F || {};
    F.ccsm = {
        api_version: 1
    };
    const us = F.ccsm;
    const userConfigKey = 'DRF:STORAGE_USER_CONFIG';

    async function fetchResource(urn, init) {
        const cfg = us.getConfig().API;
        init = init || {};
        init.headers = init.headers || new Headers();
        init.headers.set('Authorization', `JWT ${cfg.TOKEN}`);
        const url = `${cfg.URLS.BASE}/${urn.replace(/^\//, '')}`;
        const resp = await fetch(url, init);
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        return await resp.json();
    }

    function atobJWT(str) {
        /* See: https://github.com/yourkarma/JWT/issues/8 */
        return atob(str.replace(/_/g, '/').replace(/-/g, '+'));
    }

    us.getConfig = function() {
        return JSON.parse(localStorage.getItem(userConfigKey));
    };

    us.decodeToken = function(encoded_token) {
        const parts = encoded_token.split('.').map(atobJWT);
        if (parts.length !== 3) {
            throw new Error('Expected dot delimited tuple with length of 3');
        }
        return {
            header: JSON.parse(parts[0]),
            payload: JSON.parse(parts[1]),
            secret: parts[2]
        };
    };

    us.getResource = async function(resource, args_dict) {
        const url = `/v${us.api_version}/${resource}/${F.util.urlQuery(args_dict)}`;
        const res = await fetchResource(url);
        if (res.next) {
            throw new Error("Paging not supported");
        }
        return res.results;
    };

    us.getUsers = async function(args_dict) {
        return await us.getResource('user', args_dict);
    };

    us.getTokenInfo = function() {
        return us.decodeToken(us.getConfig().API.TOKEN);
    };

    us.getUserProfile = async function() {
        // XXX Make this return a F.User model.
        const user = (await F.ccsm.getUsers({
            id: F.ccsm.getTokenInfo().payload.user_id
        }))[0];
        user.image = F.util.gravatarURL(user.email, {s: 1024});
        Raven.setUserContext({
            email: user.email,
            username: user.username,
            phone: user.phone,
            name: `${user.first_name} ${user.last_name}`
        });
        return user;
    };

    us.logout = function() {
        localStorage.removeItem(userConfigKey);
        Raven.setUserContext();
        location.assign(F.urls.logout);
    };
})();
