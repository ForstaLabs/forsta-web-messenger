module.exports = function(grunt) {
  'use strict';

  const dist = 'dist';
  const static_dist = `${dist}/static`;

  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-sass');
  try {
    grunt.loadNpmTasks('grunt-contrib-watch');
  } catch(e) {
    logger.warn("Grunt 'watch' is not available");
  }

    /*"malihu-custom-scrollbar-plugin/jquery.mCustomScrollbar.min.css",
    "malihu-custom-scrollbar-plugin/mCSB_buttons.png"
    "emojijs/demo/emoji.css"
      "jquery/dist/jquery.min.map"*/
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    concat: {
      components: {
        src: [
          "components/jquery/dist/jquery.min.js",
          "components/long/dist/Long.js",
          "components/bytebuffer/dist/ByteBufferAB.js",
          "components/protobuf/dist/ProtoBuf.js",
          "components/mustache/mustache.js",
          "components/underscore/underscore.js",
          "components/backbone/backbone.js",
          "components/backbone.typeahead.collection/dist/backbone.typeahead.js",
          "components/qrcode/qrcode.js",
          "components/libphonenumber-api/libphonenumber_api-compiled.js",
          "components/moment/min/moment-with-locales.js",
          "components/indexeddb-backbonejs-adapter/backbone-indexeddb.js",
          "components/intl-tel-input/build/js/intlTelInput.js",
          "components/blueimp-load-image/js/load-image.js",
          "components/blueimp-canvas-to-blob/js/canvas-to-blob.js",
          "components/emojijs/lib/emoji.js",
          "components/autosize/dist/autosize.js",
          "components/webaudiorecorder/lib/WebAudioRecorder.js",
          "components/mp3lameencoder/lib/Mp3LameEncoder.js",
          "components/malihu-custom-scrollbar-plugin/jquery.mCustomScrollbar.concat.min.js"
        ],
        dest: `${static_dist}/components.js`,
      },
      libtextsecure: {
        options: {
          banner: ";(function() {\n",
          footer: "})();\n",
        },
        src: [
          'components/jquery/jquery.min.js',
          'components/long/dist/Long.js',
          'components/bytebuffer/dist/ByteBufferAB.js',
          'protobuf/dist/ProtoBuf.js',
          'libtextsecure/errors.js',
          'libtextsecure/libsignal-protocol.js',
          'libtextsecure/protocol_wrapper.js',
          'libtextsecure/crypto.js',
          'libtextsecure/storage.js',
          'libtextsecure/storage/user.js',
          'libtextsecure/storage/groups.js',
          'libtextsecure/protobufs.js',
          'libtextsecure/websocket-resources.js',
          'libtextsecure/helpers.js',
          'libtextsecure/stringview.js',
          'libtextsecure/event_target.js',
          'libtextsecure/api.js',
          'libtextsecure/account_manager.js',
          'libtextsecure/message_receiver.js',
          'libtextsecure/outgoing_message.js',
          'libtextsecure/sendmessage.js',
          'libtextsecure/sync_request.js',
          'libtextsecure/contacts_parser.js',
          'libtextsecure/ProvisioningCipher.js',
        ],
        dest: `${static_dist}/libtextsecure.js`,
      }
    },

    sass: {
      stylesheets: {
        options: {
            sourcemap: 'inline'
        },
        files: [{
          expand: true,
          cwd: 'stylesheets',
          src: ['*.scss'],
          dest: `${static_dist}/stylesheets`,
          ext: '.css'
        }]
      }
    },

    copy: {
      root: {
        files: [{
          expand: true,
          src: ['html/**'],
          dest: dist
        }]
      },
      static: {
        files: [{
          expand: true,
          src: [
            '_locales/**',
            'protos/**',
            'app/**',
            'emojidata/img-apple-64/**',
            'images/**',
            'fonts/**'
          ],
          dest: static_dist
        }, {
          expand: true,
          cwd: 'components',
          src: [
            'malihu-custom-scrollbar-plugin/**/*.css',
          ],
          dest: static_dist
        }]
      },
      semantic: {
        files: [{
          expand: true,
          cwd: 'semantic/dist',
          src: ['**'],
          dest: `${static_dist}/semantic`
        }]
      },
    },

    watch: {
      stylesheets: {
        files: [
          'stylesheets/*.scss',
        ],
        tasks: ['sass']
      },
      code: {
        files: [
          'libtextsecure/**',
          'app/**',
        ],
        tasks: ['concat', 'copy']
      },
      html: {
        files: [
          'html/**'
        ],
        tasks: ['copy']
      }
    }
  });

  // Transifex does not understand placeholders, so this task patches all non-en
  // locales with missing placeholders
  grunt.registerTask('locale-patch', function(){
    var en = grunt.file.readJSON('_locales/en/messages.json');
    grunt.file.recurse('_locales', function(abspath, rootdir, subdir, filename){
      if (subdir === 'en' || filename !== 'messages.json'){
        return;
      }
      var messages = grunt.file.readJSON(abspath);

      for (var key in messages){
        if (en[key] !== undefined && messages[key] !== undefined){
          if (en[key].placeholders !== undefined &&
              messages[key].placeholders === undefined){
            messages[key].placeholders = en[key].placeholders;
          }
        }
      }

      grunt.file.write(abspath, JSON.stringify(messages, null, 4) + '\n');
    });
  });

  grunt.registerTask('default', ['concat', 'sass', 'copy']);
};
