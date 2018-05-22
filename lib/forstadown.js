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
        match: /(^|\s)`([^`]+?)`(?=$|\s)/g,
        sub: '$1<samp>$2</samp>',
        stop_on_match: true
    }, {
        match: /((https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=()]*)))(">(.*)<\/a>)?/ig,
        sub: '<a href="$1" type="unfurlable">$1</a>',
        stop_on_match: true,
        parent_blacklist: ['a']
    }, {
        match: /(^|\s)!([a-zr0-9]+[^!]*?)!(?=$|\s)/gi,
        sub: '$1<blink>$2</blink>'
    }, {
        match: /(^|\s)==([a-z0-9]+[^=]*?)==(?=$|\s)/gi,
        sub: '$1<mark>$2</mark>'
    }, {
        match: /(^|\s)~~([a-z0-9]+[^~]*?)~~(?=$|\s)/gi,
        sub: '$1<del>$2</del>'
    }, {
        match: /(^|\s)__([a-z0-9]+[^_]*?)__(?=$|\s)/gi,
        sub: '$1<u>$2</u>'
    }, {
        match: /(^|\s)\^([a-z0-9]+[^^]*?)\^(?=$|\s)/gi,
        sub: '$1<sup>$2</sup>'
    }, {
        match: /(^|\s)\?([a-z0-9]+[^?]*?)\?(?=$|\s)/gi,
        sub: '$1<sub>$2</sub>'
    }, {
        match: /(^|\s)_([a-z0-9]+[^_]*?)_(?=$|\s)/gi,
        sub: '$1<em>$2</em>'
    }, {
        match: /(^|\s)\*([a-z0-9]+[^*]*)\*(?=$|\s)/gi,
        sub: '$1<strong>$2</strong>'
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
