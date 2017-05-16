/*
 * vim: ts=4:sw=4:expandtab
 */

;(function() {
    'use strict';

    window.ccsm = window.ccsm || {};

    ccsm.api_version = 1;

    ccsm.getConfig = function() {
        return JSON.parse(localStorage.getItem('DRF:STORAGE_USER_CONFIG'));
    };

    ccsm._fetch = async function(urn, init) {
        const cfg = ccsm.getConfig().API;
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

    ccsm.getResource = async function(resource, args_dict) {
        let qs = '';
        if (args_dict !== undefined) {
            const args = [];
            for (let x of Object.keys(args_dict)) {
                args.push(`${x}=${args_dict[x]}`);
            }
            qs = '?' + args.join('&');
        }
        /* XXX/TODO Return iterator over results with paging support. */
        return await ccsm._fetch(`/v${ccsm.api_version}/${resource}/${qs}`);
    };

    ccsm.getUsers = async function(args_dict) {
        return await ccsm.getResource('user', args_dict);
    };
})();
