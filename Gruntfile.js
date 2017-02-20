module.exports = function(grunt) {
  'use strict';

  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-sass');
  grunt.loadNpmTasks('grunt-gitinfo');
  grunt.loadNpmTasks('grunt-preen');

  var bower = grunt.file.readJSON('bower.json');
  var components = [];
  for (var i in bower.concat.app) {
    components.push('components/' + bower.concat.app[i] + '/**/*.js');
  }
  components.push('components/' + 'webaudiorecorder/lib/WebAudioRecorder.js');

  var libtextsecurecomponents = [];
  for (i in bower.concat.libtextsecure) {
    libtextsecurecomponents.push('components/' + bower.concat.libtextsecure[i] + '/**/*.js');
  }

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    concat: {
      components: {
        src: components,
        dest: 'js/components.js',
      },
      libtextsecurecomponents: {
        src: libtextsecurecomponents,
        dest: 'libtextsecure/components.js',
      },
      libtextsecure: {
        options: {
          banner: ";(function() {\n",
          footer: "})();\n",
        },
        src: [
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
        dest: 'js/libtextsecure.js',
      }
    },
    sass: {
      stylesheets: {
        files: {
          'stylesheets/manifest.css': 'stylesheets/manifest.scss',
          'stylesheets/options.css': 'stylesheets/options.scss'
        }
      }
    },
    dist: {
      src: [
        'inbox.html',
        'install.html',
        'register.html',
        '_locales/**',
        'protos/*',
        'js/**',
        'stylesheets/*.css',
        '!js/register.js'
      ],
      res: [
        'components/emojidata/img-apple-64/*',
        'images/**',
        'fonts/*'
      ]
    },
    copy: {
      res: {
        files: [{ expand: true, dest: 'dist/', src: ['<%= dist.res %>'] }]
      },
      src: {
        files: [{ expand: true, dest: 'dist/', src: ['<%= dist.src %>'] }],
        options: {
          process: function(content, srcpath) {
            if (srcpath.match('expire.js')) {
              var gitinfo = grunt.config.get('gitinfo');
              var commited = gitinfo.local.branch.current.lastCommitTime;
              var time = Date.parse(commited) + 1000 * 60 * 60 * 24 * 90;
              return content.replace(
                /var BUILD_EXPIRATION = 0/,
                "var BUILD_EXPIRATION = " + time
              );
            } else {
              return content;
            }
          }
        }
      }
    },
    gitinfo: {} // to be populated by grunt gitinfo
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
          if (en[key].placeholders !== undefined && messages[key].placeholders === undefined){
            messages[key].placeholders = en[key].placeholders;
          }
        }
      }

      grunt.file.write(abspath, JSON.stringify(messages, null, 4) + '\n');
    });
  });

  grunt.registerTask('copy_dist', ['gitinfo', 'copy']);
  grunt.registerTask('default', ['concat', 'sass', 'copy_dist']);
};
