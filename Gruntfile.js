// vim: et sw=2 ts=2
/* global module, require */

const fs = require('fs');
const path = require('path');


function assert_exists(file) {
    if (!fs.existsSync(file)) {
        throw new Error(`File not found: ${file}`);
    }
    return file;
}

function add_prefix(left, right) {
    return assert_exists(path.join(left, right));
}


module.exports = function(grunt) {
  'use strict';

  const dist = 'dist';
  const static_dist = `${dist}/static`;
  const pkg = grunt.file.readJSON('package.json');

  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-sass');
  grunt.loadNpmTasks('grunt-contrib-uglify-es');
  grunt.loadNpmTasks('grunt-concurrent');
  try {
    grunt.loadNpmTasks('grunt-contrib-watch');
  } catch(e) {
    console.warn("Grunt 'watch' is not available");
  }
  const banner = `self.F = self.F || {};\nF.version = "${pkg.version}";\n`;

  grunt.initConfig({
    pkg,

    concat: {

      app_deps: {
        src: [
          "../lib/idb-iegap.js",
          "jquery/dist/jquery.js",
          "long/dist/long.js",
          "bytebuffer/dist/ByteBufferAB.js",
          "protobuf/dist/ProtoBuf.js",
          "handlebars/handlebars.js",
          "underscore/underscore.js",
          "backbone/backbone.js",
          "qrcode/qrcode.js",
          "moment/min/moment-with-locales.js",
          "../lib/backbone-indexeddb.js",
          "blueimp-load-image/js/load-image.all.min.js",
          "blueimp-md5/js/md5.min.js",  // Cleaner than !min version
          "../node_modules/emoji-js/lib/emoji.js",
          "jquery-oembed-all/jquery.oembed.js",
          "dompurify/dist/purify.js",
          "platform.js/platform.js",
          "../lib/forstadown.js",
          "../lib/async_queue.js",
          "../lib/async_event_target.js",
          "../lib/buffered_function.js",
          "../lib/mnemonic/words/english.js",
          "../lib/mnemonic/mnemonic.js",
          "../lib/runes.js",
          "../node_modules/webrtc-adapter/out/adapter.js",
          "../node_modules/quill/dist/quill.js",
          "../node_modules/quill-delta-to-html/dist/browser/QuillDeltaToHtmlConverter.bundle.js",
          "../node_modules/exif-js/exif.js",
          "raven-js/dist/raven.js"  // Ensure this is last.
        ].map(x => add_prefix('components', x)),
        dest: `${static_dist}/js/app/deps.js`
      },

      worker_deps: {
        src: [
          "../lib/idb-iegap.js",
          "long/dist/long.js",
          "bytebuffer/dist/ByteBufferAB.js",
          "protobuf/dist/ProtoBuf.js",
          "underscore/underscore.js",
          "backbone/backbone.js",
          "../lib/backbone-indexeddb.js",
          "blueimp-md5/js/md5.min.js",  // Cleaner than !min version
          "platform.js/platform.js",
          "../lib/async_queue.js",
          "../lib/async_event_target.js",
          "../lib/buffered_function.js",
          "../lib/runes.js",
          "raven-js/dist/raven.js"  // Ensure this is last.
        ].map(x => add_prefix('components', x)),
        dest: `${static_dist}/js/worker/deps.js`
      },

      lib_relay: {
        src: [
          'init.js',
          'errors.js',
          'crypto.js',
          'protobufs.js',
          'queue_async.js',
          'websocket_resources.js',
          'util.js',
          'hub.js',
          'event_target.js',
          'account_manager.js',
          'message_receiver.js',
          'message_sender.js',
          'outgoing_message.js',
          'provisioning_cipher.js',
        ].map(x => add_prefix('node_modules/librelay-web/src', x)),
        dest: `${static_dist}/js/lib/relay.js`
      },

      lib_signal: {
        src: [
           'build/curve25519.js',
           'build/components_concat.js',
           'build/protobufs_concat.js',
           'src/compat.js',
           'src/errors.js',
           'src/curve25519_wrapper.js',
           'src/curve.js',
           'src/crypto.js',
           'src/util.js',
           'src/keyhelper.js',
           'src/SessionRecord.js',
           'src/ProtocolAddress.js',
           'src/SessionBuilder.js',
           'src/SessionCipher.js',
           'src/SessionLock.js',
        ].map(x => add_prefix('node_modules/libsignal-protocol', x)),
        dest: `${static_dist}/js/lib/signal.js`
      },

      app_main: {
        options: {banner},
        src: [
          'ga.js',
          'version.js',
          'database.js',
          'cache.js',
          'util.js',
          'templates.js',
          'atlas.js',
          'state.js',
          'store.js',
          'service_worker.js',
          'notifications.js',
          'sync.js',
          'calling.js',
          'models/searchable.js',
          'models/atlas.js',
          'models/users.js',
          'models/contacts.js',
          'models/org.js',
          'models/tags.js',
          'models/receipts.js',
          'models/messages.js',
          'models/threads.js',
          'models/state.js',
          'models/trusted_identities.js',
          'models/quarantined_messages.js',
          'models/counters.js',
          'emoji.js',
          'router.js',
          'views/base.js',
          'views/modal.js',
          'views/header.js',
          'views/file_input.js',
          'views/list.js',
          'views/popup.js',
          'views/nav.js',
          'views/attachment.js',
          'views/timestamp.js',
          'views/message.js',
          'views/thread.js',
          'views/thread_stack.js',
          'views/conversation.js',
          'views/announcement.js',
          'views/compose.js',
          'views/new_thread.js',
          'views/main.js',
          'views/giphy.js',
          'views/phone_suggestion.js',
          'views/emoji_picker.js',
          'views/import_contacts.js',
          'views/settings.js',
          'views/archived_threads.js',
          'views/linked_devices.js',
          'views/user_card.js',
          'views/tag_card.js',
          'views/zendesk_card.js',
          'views/dist_editor.js',
          'views/call.js',
          'views/provision.js',
          'easter.js',
          'foundation.js',
          'reset.js',
          'main.js'
        ].map(x => add_prefix('app', x)),
        dest: `${static_dist}/js/app/main.js`
      },

      app_install: {
        options: {banner},
        src: [
          'ga.js',
          'version.js',
          'database.js',
          'cache.js',
          'util.js',
          'templates.js',
          'atlas.js',
          'state.js',
          'store.js',
          'models/searchable.js',
          'models/atlas.js',
          'models/users.js',
          'models/contacts.js',
          'models/org.js',
          'models/tags.js',
          'models/messages.js',
          'models/threads.js',
          'models/state.js',
          'models/trusted_identities.js',
          'models/quarantined_messages.js',
          'models/counters.js',
          'views/base.js',
          'views/modal.js',
          'views/header.js',
          'views/install.js',
          'views/user_card.js',
          'views/tag_card.js',
          'views/linked_devices.js',
          'easter.js',
          'foundation.js',
          'reset.js',
          'install.js'
        ].map(x => add_prefix('app', x)),
        dest: `${static_dist}/js/app/install.js`
      },

      app_signin: {
        options: {banner},
        src: [
          'ga.js',
          'version.js',
          'database.js',
          'cache.js',
          'util.js',
          'templates.js',
          'atlas.js',
          'state.js',
          'store.js',
          'models/searchable.js',
          'models/atlas.js',
          'models/users.js',
          'models/contacts.js',
          'models/org.js',
          'models/tags.js',
          'models/state.js',
          'models/trusted_identities.js',
          'views/base.js',
          'views/modal.js',
          'views/signin.js',
          'foundation.js',
          'reset.js',
          'signin.js'
        ].map(x => add_prefix('app', x)),
        dest: `${static_dist}/js/app/signin.js`
      },

      app_embed: {
        options: {banner},
        src: [
          'ga.js',
          'version.js',
          'database.js',
          'cache.js',
          'util.js',
          'templates.js',
          'atlas.js',
          'state.js',
          'store.js',
          'sync.js',
          'calling.js',
          'models/searchable.js',
          'models/atlas.js',
          'models/users.js',
          'models/contacts.js',
          'models/org.js',
          'models/tags.js',
          'models/receipts.js',
          'models/messages.js',
          'models/threads.js',
          'models/state.js',
          'models/trusted_identities.js',
          'models/quarantined_messages.js',
          'models/counters.js',
          'emoji.js',
          'router.js',
          'views/base.js',
          'views/modal.js',
          'views/file_input.js',
          'views/list.js',
          'views/popup.js',
          'views/attachment.js',
          'views/timestamp.js',
          'views/message.js',
          'views/thread.js',
          'views/thread_stack.js',
          'views/conversation.js',
          'views/announcement.js',
          'views/compose.js',
          'views/embed.js',
          'views/giphy.js',
          'views/emoji_picker.js',
          'views/user_card.js',
          'views/tag_card.js',
          'views/zendesk_card.js',
          'views/call.js',
          'easter.js',
          'foundation.js',
          'reset.js',
          'embed.js'
        ].map(x => add_prefix('app', x)),
        dest: `${static_dist}/js/app/embed.js`
      },

      worker_service: {
        options: {banner},
        src: [
          'worker/service/imports.js',
          'app/version.js',
          'app/database.js',
          'app/cache.js',
          'app/util.js',
          'app/templates.js',
          'app/atlas.js',
          'app/state.js',
          'app/store.js',
          'app/sync.js',
          'app/calling.js',
          'app/notifications.js',
          'app/models/searchable.js',
          'app/models/atlas.js',
          'app/models/users.js',
          'app/models/contacts.js',
          'app/models/org.js',
          'app/models/tags.js',
          'app/models/receipts.js',
          'app/models/messages.js',
          'app/models/threads.js',
          'app/models/state.js',
          'app/models/trusted_identities.js',
          'app/models/quarantined_messages.js',
          'app/models/counters.js',
          'app/foundation.js',
          'worker/service/main.js'
        ].map(assert_exists),
        dest: `${static_dist}/js/worker/service.js`
      },

      worker_shared: {
        src: [
          'worker/shared/main.js'
        ].map(assert_exists),
        dest: `${static_dist}/js/worker/shared.js`
      }
    },

    concurrent: {
      uglify: [
        'uglify:app_deps',
        'uglify:worker_deps',
        'uglify:lib_relay',
        'uglify:lib_signal',
        'uglify:app_main',
        'uglify:app_install',
        'uglify:app_signin',
        'uglify:app_embed',
        'uglify:worker_service',
        'uglify:worker_shared'
      ],
      options: {
        logConcurrentOutput: true,
      }
    },

    uglify: {
      options: {
        mangle: {
          safari10: true,
          keep_fnames: true
        },
        compress: {
          unused: false,
          keep_fnames: true
        },
        output: {
          max_line_len: 1000,
          safari10: true
        }
      },

      app_deps: {
        files: [{
          src: `${static_dist}/js/app/deps.js`,
          dest: `${static_dist}/js/app/deps.min.js`
        }]
      },

      worker_deps: {
        files: [{
          src: [`${static_dist}/js/worker/deps.js`],
          dest: `${static_dist}/js/worker/deps.min.js`
        }]
      },

      lib_relay: {
        files: [{
          src: [`${static_dist}/js/lib/relay.js`],
          dest: `${static_dist}/js/lib/relay.min.js`
        }]
      },

      lib_signal: {
        files: [{
          src: [`${static_dist}/js/lib/signal.js`],
          dest: `${static_dist}/js/lib/signal.min.js`
        }]
      },

      app_main: {
        files: [{
          src: [`${static_dist}/js/app/main.js`],
          dest: `${static_dist}/js/app/main.min.js`
        }]
      },

      app_install: {
        files: [{
          src: [`${static_dist}/js/app/install.js`],
          dest: `${static_dist}/js/app/install.min.js`
        }]
      },

      app_signin: {
        files: [{
          src: [`${static_dist}/js/app/signin.js`],
          dest: `${static_dist}/js/app/signin.min.js`
        }]
      },

      app_embed: {
        files: [{
          src: [`${static_dist}/js/app/embed.js`],
          dest: `${static_dist}/js/app/embed.min.js`
        }]
      },

      worker_service: {
        files: [{
          src: [`${static_dist}/js/worker/service.js`],
          dest: `${static_dist}/js/worker/service.min.js`
        }]
      },

      worker_shared: {
        files: [{
          src: [`${static_dist}/js/worker/shared.js`],
          dest: `${static_dist}/js/worker/shared.min.js`
        }]
      }
    },

    sass: {
      stylesheets: {
        options: {
            sourcemap: 'inline',
            style: 'compressed'
        },
        files: [{
          expand: true,
          cwd: 'stylesheets',
          src: ['**/*.scss'],
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
            'images/**',
            'audio/**',
            'fonts/**',
            'templates/**',
            'manifest.json',
          ],
          dest: static_dist
        }, {
          expand: true,
          cwd: 'node_modules/emoji-datasource-google/img',
          src: ['google/64/*', 'google/sheets/*'],
          dest: `${static_dist}/images/emoji`
        }, {
          expand: true,
          cwd: 'node_modules/emoji-datasource',
          src: ['emoji.json'],
          dest: `${static_dist}/images/emoji`
        }, {
          expand: true,
          cwd: 'node_modules/librelay-web/',
          src: ['protos/**'],
          dest: static_dist
        }]
      },

      semantic: {
        nonull: true,
        files: [{
          expand: true,
          cwd: 'semantic/dist',
          src: ['**'],
          dest: `${static_dist}/semantic`
        }]
      }
    },

    watch: {
      stylesheets: {
        files: [
          'stylesheets/**/*.scss',
        ],
        tasks: ['sass']
      },
      code: {
        files: [
          'node_modules/librelay-web/src/**',
          'node_modules/libsignal-protocol-javascript/src/**',
          'lib/**',
          'app/**',
          'worker/**',
          'Gruntfile.js'
        ],
        tasks: ['concat', 'copy']
      },
      html: {
        files: [
          'protos/**',
          'images/**',
          'audio/**',
          'fonts/**',
          'templates/**',
          'html/**'
        ],
        tasks: ['copy']
      }
    }
  });

  grunt.registerTask('default', ['concat', 'concurrent:uglify', 'sass', 'copy']);
};
