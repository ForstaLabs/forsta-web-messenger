const fs = require('fs');
const path = require('path');


function add_prefix(left, right) {
    const file = path.join(left, right);
    if (!fs.existsSync(file)) {
        throw new Error(`File not found: ${file}`);
    }
    return file;
}


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

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    concat: {
      lib_deps: {
        src: [
          "jquery/dist/jquery.min.js",
          "long/dist/long.min.js",
          "bytebuffer/dist/ByteBufferAB.min.js",
          "protobuf/dist/ProtoBuf.min.js",
          "mustache/mustache.js",
          "underscore/underscore-min.js",
          "backbone/backbone.js",
          "backbone.typeahead.collection/dist/backbone.typeahead.min.js",
          "qrcode/qrcode.min.js",
          "libphonenumber-api/libphonenumber_api-compiled.js",
          "moment/min/moment-with-locales.js",
          "indexeddb-backbonejs-adapter/backbone-indexeddb.js",
          "intl-tel-input/build/js/intlTelInput.min.js",
          "blueimp-load-image/js/load-image.js",
          "blueimp-canvas-to-blob/js/canvas-to-blob.min.js",
          "emojijs/lib/emoji.min.js",
          "autosize/dist/autosize.min.js",
          "webaudiorecorder/lib/WebAudioRecorder.js"
        ].map(x => add_prefix('components', x)),
        dest: `${static_dist}/lib/deps.js`
      },

      lib_textsecure: {
        options: {
          banner: ";(function() {\n",
          footer: "})();\n",
        },
        src: [
          'init.js',
          'errors.js',
          'libsignal-protocol.js',
          'crypto.js',
          'storage.js',
          'storage/user.js',
          'storage/groups.js',
          'protobufs.js',
          'websocket-resources.js',
          'helpers.js',
          'stringview.js',
          'event_target.js',
          'api.js',
          'account_manager.js',
          'message_receiver.js',
          'outgoing_message.js',
          'sendmessage.js',
          'sync_request.js',
          'contacts_parser.js',
          'ProvisioningCipher.js',
        ].map(x => add_prefix('lib/textsecure', x)),
        dest: `${static_dist}/lib/textsecure.js`
      },

      app_inbox: {
        src: [
          'compat.js',
          'ccsm.js',
          'database.js',
          'debugLog.js',
          'storage.js',
          'signal_protocol_store.js',
          'notifications.js',
          'delivery_receipts.js',
          'read_receipts.js',
          'libphonenumber-util.js',
          'models/messages.js',
          'models/conversations.js',
          'models/blockedNumbers.js',
          'expiring_messages.js',
          'i18n.js',
          'registration.js',
          'conversation_controller.js',
          'panel_controller.js',
          'emoji_util.js',
          'views/whisper_view.js',
          'views/debug_log_view.js',
          'views/toast_view.js',
          'views/attachment_preview_view.js',
          'views/file_input_view.js',
          'views/list_view.js',
          'views/conversation_list_item_view.js',
          'views/conversation_list_view.js',
          'views/contact_list_view.js',
          'views/recipients_input_view.js',
          'views/new_group_update_view.js',
          'views/attachment_view.js',
          'views/key_conflict_dialogue_view.js',
          'views/error_view.js',
          'views/timestamp_view.js',
          'views/message_view.js',
          'views/key_verification_view.js',
          'views/message_detail_view.js',
          'views/message_list_view.js',
          'views/group_member_list_view.js',
          'views/recorder_view.js',
          'views/conversation_view.js',
          'views/conversation_search_view.js',
          'views/hint_view.js',
          'views/inbox_view.js',
          'views/confirmation_dialog_view.js',
          'views/identicon_svg_view.js',
          'views/settings_view.js',
          'foundation.js',
          'inbox.js'
        ].map(x => add_prefix('app', x)),
        dest: `${static_dist}/app/inbox.js`
      },

      app_install: {
        src: [
          'compat.js',
          'ccsm.js',
          'database.js',
          'storage.js',
          'signal_protocol_store.js',
          'libphonenumber-util.js',
          'models/messages.js',
          'models/conversations.js',
          'panel_controller.js',
          'conversation_controller.js',
          'i18n.js',
          'registration.js',
          'views/whisper_view.js',
          'views/phone-input-view.js',
          'views/install_view.js',
          'foundation.js',
          'install.js'
        ].map(x => add_prefix('app', x)),
        dest: `${static_dist}/app/install.js`
      },

      app_register: {
        src: [
          'compat.js',
          'ccsm.js',
          'database.js',
          'debugLog.js',
          'storage.js',
          'signal_protocol_store.js',
          'libphonenumber-util.js',
          'models/messages.js',
          'models/conversations.js',
          'panel_controller.js',
          'conversation_controller.js',
          'i18n.js',
          'registration.js',
          'views/whisper_view.js',
          'views/phone-input-view.js',
          'views/install_view.js',
          'foundation.js',
          'register.js'
        ].map(x => add_prefix('app', x)),
        dest: `${static_dist}/app/register.js`
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
        nonull: true,
        files: [{
          expand: true,
          src: ['html/**'],
          dest: dist
        }]
      },

      static: {
        nonull: true,
        files: [{
          expand: true,
          src: [
            '_locales/**',
            'protos/**',
            'emojidata/img-apple-64/**',
            'images/**',
            'fonts/**'
          ],
          dest: static_dist
        }, {
          expand: true,
          cwd: 'components/webaudiorecorder/lib',
          src: [
            'WebAudioRecorderMp3.js',
            'Mp3LameEncoder.min.js',
            'Mp3LameEncoder.min.js.mem'
          ],
          dest: `${static_dist}/lib/webaudiorecorder`
        }]
      },

      semantic: {
        nonull: true,
        files: [{
          expand: true,
          cwd: 'semantic/dist',
          src: ['**'],
          dest: `${static_dist}/lib/semantic`
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
          'lib/textsecure/**',
          'app/**',
          'Gruntfile.js'
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

  grunt.registerTask('default', ['concat', 'sass', 'copy']);
};
