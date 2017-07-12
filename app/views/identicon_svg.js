// vim: ts=4:sw=4:expandtab
/* global loadImage */

(function () {
    'use strict';
    self.F = self.F || {};

    const COLORS = {
        red         : '#db2828',
        orange      : '#fa7d20',
        yellow      : '#fbbd08',
        olive       : '#b5cc18',
        green       : '#21ba45',
        teal        : '#00b5ad',
        blue        : '#2185d0',
        violet      : '#6435c9',
        purple      : '#a333c8',
        pink        : '#e03997',
        brown       : '#a5673f',
        grey        : '#767676',
        black       : '#1b1c1d'
    };

    /*
    * Render an avatar identicon to an svg for use in a notification.
    */
    F.IdenticonSVGView = F.View.extend({
        template: 'util/identicon.html',

        initialize: function(options) {
            this.render_attributes = options;
            this.render_attributes.color = COLORS[this.render_attributes.color];
        },

        getSVGUrl: function() {
            var html = this.render().$el.html();
            var svg = new Blob([html], {type: 'image/svg+xml;charset=utf-8'});
            return URL.createObjectURL(svg);
        },

        getDataUrl: function() {
            var svgurl = this.getSVGUrl();
            return new Promise(function(resolve) {
                var img = document.createElement('img');
                img.onload = function () {
                    var canvas = loadImage.scale(img, {
                        canvas: true, maxWidth: 100, maxHeight: 100
                    });
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    URL.revokeObjectURL(svgurl);
                    resolve(canvas.toDataURL('image/png'));
                };

                img.src = svgurl;
            });
        }
    });
})();
