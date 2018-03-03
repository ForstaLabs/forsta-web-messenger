// vim: ts=4:sw=4:expandtab
/* global relay gapi */

(function () {
    'use strict';

    self.F = self.F || {};

    const scope = "https://www.youtube.com/iframe_api";

    let _youtubeApiInit;

    async function onYouTubeIframeAPIReady() {
        await new Promise((resolve, reject) => {
            $.ajax({
                url: 'https://apis.google.com/js/api.js',
                dataType: 'script',
                cache: true
            }).then(resolve).catch(reject);
        });
        await new Promise((resolve, reject) => {
            gapi.load('client:auth2', {
                callback: resolve,
                onerror: reject,
                ontimeout: reject,
                timeout: 30000,
            });
        });
        await gapi.client.init({
            clientId:
            scope,
            discoveryDocs: ['https://people.googleapis.com/$discovery/rest']
        });
    }
       player = new YT.Player('player', {
         height: '355',
         width: '100%',
         videoId: 'GqCc-vgjTfA',
         playerVars: { 'autoplay': 0, 'rel': 0, },
         events: {
           'onReady': onPlayerReady,
           'onStateChange': onPlayerStateChange
         }
       });
      }

    function onPlayerReady(event) {
     event.target.pauseVideo();
    }

    var done = false;
    function onPlayerStateChange(event) {
     if (event.data == YT.PlayerState.PLAYING && !done) {
       setTimeout(stopVideo, 6000);
       done = true;
     }
    }
    function stopVideo() {
     player.stopVideo();
    }

    F.IntroVideoView = F.ModalView.extend({
        template: 'views/intro-video.html',

        events: {
            'click .actions .button.f-dismiss': 'onDismissClick'
        },

        initialize: function() {
            F.ModalView.prototype.initialize.call(this, {
                size: 'tiny',
                options: {
                    closable: false
                }
            });
        },

        onDismissClick: function() {
            this.hide();
            this.remove();
            console.log('hide the modal')
        }

    });
})();
