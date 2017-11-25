/* global module */

(function() {
    "use strict";

    const root = this;
    const ns = {};

    if (typeof module !== 'undefined' && module.exports) {
        /* Running in nodejs */
        module.exports = ns;
    } else {
        /* Running in browser */
        root.forstadown = ns;
    }

    const fdExpressions = [{
        tag: 'samp',
        stop_on_match: true,
        match: /`(.+)`/g
    }, {
        tag: 'a',
        stop_on_match: true,
        match: /((https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=()]*)))(">(.*)<\/a>)?/ig,
        sub: '<a href="$1" type="unfurlable">$1</a>',
        parent_blacklist: ['a']
    }, {
        tag: 'blink',
        match: /!([a-z<>r0-9]+[^!]*)!/gi
    }, {
        tag: 'mark',
        match: /==([a-z<>0-9]+.*)==/g
    }, {
        tag: 'del',
        match: /~~([a-z<>0-9]+.*)~~/g
    }, {
        tag: 'u',
        match: /__([a-z<>0-9]+[^_]*)__/gi
    }, {
        tag: 'sup',
        match: /\^([a-z<>0-9]+[^^]*)\^/gi
    }, {
        tag: 'sub',
        match: /\?([a-z<>0-9]+[^?]*)\?/gi
    }, {
        tag: 'em',
        match: /_([a-z<>0-9]+[^_]*)_/gi
    }, {
        tag: 'strong',
        match: /\*([^\s*]+[^*]*)\*/g
    }, {
        tag: 'h1',
        match: /#{3}\s(.+?)\s#{3}/gm
    }, {
        tag: 'h3',
        match: /#{2}\s(.+?)\s#{2}/gm
    }, {
        tag: 'h5',
        match: /#{1}\s(.+?)\s#{1}/gm
    }];
  
    ns.blockConvert = function(html) {
        let open = false;
        return html.split(/(```)/).map(x => {
            if (x === '```') {
                open = !open;
                return open ? '<code>' : '</code>';
            } else {
                return x;
            }
        }).join('');
    };

    ns.inlineConvert = function(text, parents) {
        /* Do all the inline ones now */
        if (parents.has('code')) {
            return text;
        }
        let val = text;
        for (const expr of fdExpressions) {
            if (val.match(expr.match)) {
                if (expr.parent_blacklist &&
                    !!expr.parent_blacklist.filter(x => parents.has(x)).length) {
                    if (expr.stop_on_match) {
                        break;
                    } else {
                        continue;
                    }
                }
                const sub = expr.sub || `<${expr.tag}>$1</${expr.tag}>`;
                val = val.replace(expr.replace || expr.match, sub);
                if (expr.stop_on_match) {
                    break;
                }
            }
        }
        return val;
    };
}).call(this);
