/*
 * vim: ts=4:sw=4:expandtab
 */

;(function() {
    'use strict';

    window.F = window.F || {};
    F.ccsm = {
        api_version: 1
    };

    async function fetchResource(urn, init) {
        const cfg = F.ccsm.getConfig().API;
        init = init || {};
        init.headers = init.headers || new Headers();
        init.headers.set('Authorization', `JWT ${cfg.TOKEN}`);
        const url = `${cfg.URLS.BASE}/${urn.replace(/^\//, '')}`;
        const resp = await window.fetch(url, init);
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        return await resp.json();
    };

    F.ccsm.getConfig = function() {
        return JSON.parse(localStorage.getItem('DRF:STORAGE_USER_CONFIG'));
    };

    F.ccsm.getResource = async function(resource, args_dict) {
        let qs = '';
        if (args_dict !== undefined) {
            const args = [];
            for (let x of Object.keys(args_dict)) {
                args.push(`${x}=${args_dict[x]}`);
            }
            qs = '?' + args.join('&');
        }
        console.warn("TODO: Iter with paging support.");
        const url = `/v${F.ccsm.api_version}/${resource}/${qs}`;
        return await fetchResource(url);
    };

    F.ccsm.getUsers = async function(args_dict) {
        return await F.ccsm.getResource('user', args_dict);
    };
})();
