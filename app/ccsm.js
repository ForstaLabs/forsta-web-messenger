/*
 * vim: ts=4:sw=4:expandtab
 */

;(function() {
    'use strict';

    window.F = window.F || {};
    F.ccsm = {
        api_version: 1
    };
    const us = F.ccsm;

    function qs(args_dict) {
        if (!args_dict) {
            return '';
        }
        const args = Object.keys(args_dict).map(x =>
            `${encodeURIComponent(x)}=${encodeURIComponent(args_dict[x])}`);
        return '?' + args.join('&');
    }

    async function fetchResource(urn, init) {
        const cfg = us.getConfig().API;
        init = init || {};
        init.headers = init.headers || new Headers();
        init.headers.set('Authorization', `JWT ${cfg.TOKEN}`);
        const url = `${cfg.URLS.BASE}/${urn.replace(/^\//, '')}`;
        const resp = await window.fetch(url, init);
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        return await resp.json();
    }

    function atobJWT(str) {
        /* See: https://github.com/yourkarma/JWT/issues/8 */
        return atob(str.replace('_', '/').replace('-', '+'));
    }

    us.getConfig = function() {
        return JSON.parse(localStorage.getItem('DRF:STORAGE_USER_CONFIG'));
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
        const url = `/v${us.api_version}/${resource}/${qs(args_dict)}`;
        const res = await fetchResource(url);
        console.warn("TODO: Iter with paging support.");
        return res.results;
    };

    us.getUsers = async function(args_dict) {
        return await us.getResource('user', args_dict);
    };

    us.getTokenInfo = function() {
        return us.decodeToken(us.getConfig().API.TOKEN);
    };

    us.getUserProfile = async function() {
        const user = (await F.ccsm.getUsers({
            id: F.ccsm.getTokenInfo().payload.user_id
        }))[0];
        const q = qs({
            r: 'pg',    // rating
            d: 'retro', // default if not found
            s: 1024     // size
        });
        user.image = `https://www.gravatar.com/avatar/${md5(user.email)}${q}`;
        return user;
    };
})();
