default: build

PACKAGES := node_modules/.packages.build
SEMANTIC := semantic/dist/.semantic.build
BOWER := components/.bower.build
GRUNT := dist/.grunt.build
LINT := .lint.pass
TEST := .test.pass
BUILD := dist/build.json
QUILL_SYMLINK := stylesheets/_quill.scss
OEMBED_SYMLINK := stylesheets/_oembed.scss
SYMLINKS := $(QUILL_SYMLINK) $(OEMBED_SYMLINK)

export ATLAS_URL ?= https://atlas-dev.forsta.io
export ATLAS_UI_URL ?= https://app-dev.forsta.io
export SIGNAL_URL ?= https://signal-dev.forsta.io
export HAS_AVATAR_SERVICE ?= 1
export RESET_CACHE ?= 1
export NO_MINIFY ?= 1
export MORGAN_LOGGING ?= dev

packages: $(PACKAGES)
semantic: $(SEMANTIC)
bower: $(BOWER)
grunt: $(GRUNT)

NPATH := $(shell pwd)/node_modules/.bin
SRC := $(shell find app lib stylesheets -type f 2>/dev/null)

########################################################
# Building & cleaning targets
########################################################

$(PACKAGES): package.json
	npm install
	touch $@

$(SEMANTIC): $(PACKAGES) $(shell find semantic/src semantic/tasks -type f 2>/dev/null)
	cd semantic && $(NPATH)/gulp build
	touch $@

$(BOWER): $(PACKAGES) bower.json Makefile
	if [ -n "$$GITHUB_AUTH_TOKEN" ] ; then \
	    git config --global credential.helper "$$PWD/.heroku_env_auth"; \
	fi
	$(NPATH)/bower --allow-root install
	touch $@

$(QUILL_SYMLINK):
	ln -sf ../node_modules/quill/dist/quill.snow.css $@

$(OEMBED_SYMLINK):
	ln -sf ../components/jquery-oembed-all/jquery.oembed.css $@

OEMBED_SYMLINK := stylesheets/_oembed.scss

ifneq ($(NODE_ENV),production)
$(LINT): $(SRC) Makefile
	$(NPATH)/eslint app lib worker tests
	touch $@

$(TEST): $(SRC) $(shell find tests -type f 2>/dev/null) Makefile
	node tests/forstaDownTest.js
	npm test
	touch $@
else
$(LINT):
	touch $@

$(TEST):
	touch $@
endif

$(GRUNT): $(BOWER) $(SEMANTIC) $(SYMLINKS) Gruntfile.js $(SRC) $(LINT) Makefile
	$(NPATH)/grunt default
	touch $@

$(BUILD): $(GRUNT) $(TEST) Makefile
	echo '{"git_commit": "$(or $(SOURCE_VERSION),$(shell git rev-parse HEAD))"}' > $@

clean:
	rm -rf $(PACKAGES) $(SEMANTIC) $(BOWER) $(GRUNT) dist builds

realclean: clean
	rm -rf node_modules components $(SYMLINKS)

build: $(BUILD)

lint: $(LINT)

test: $(TEST)

########################################################
# Runtime-only targets
########################################################
watch:
	$(NPATH)/grunt watch

run: $(BUILD)
	node server/start.js

forcerun:
	node server/start.js

run-electron: $(BUILD)
	$(NPATH)/electron .

ELECTRON_IGNORES := \
	--ignore '^/.bowerrc' \
	--ignore '^/.buildpacks' \
	--ignore '^/.github' \
	--ignore '^/.gitignore' \
	--ignore '^/.lint.pass' \
	--ignore '^/.npmrc' \
	--ignore '^/.sass-cache' \
	--ignore '^/.slugignore' \
	--ignore '^/Gemfile.*' \
	--ignore '^/Gruntfile.js.json' \
	--ignore '^/Makefile' \
	--ignore '^/Procfile' \
	--ignore '^/app' \
	--ignore '^/audio' \
	--ignore '^/bower.json' \
	--ignore '^/build' \
	--ignore '^/components' \
	--ignore '^/fonts' \
	--ignore '^/html' \
	--ignore '^/images' \
	--ignore '^/lib' \
	--ignore '^/references' \
	--ignore '^/semantic' \
	--ignore '^/semantic.json' \
	--ignore '^/stylesheets' \
	--ignore '^/templates' \
	--ignore '^/tests' \
	--ignore '^/worker' \
	--ignore '^/node_modules/semantic-ui' \
	--ignore '^/node_modules/librelay-web' \
	--ignore '^/node_modules/libsignal-protocol' \
	--ignore '^/node_modules/bower' \
	--ignore '^/node_modules/.*emoji.*'

electron:
	$(NPATH)/electron-packager . \
		--overwrite \
		--icon images/$$([ "$(shell uname)" == "Darwin" ] && echo images/app.icns || echo app.png) \
		--out builds \
		--appBundleId io.forsta.messenger \
		$(ELECTRON_IGNORES)

electron-win32:
	$(NPATH)/electron-packager . \
		--overwrite \
		--platform win32 \
		--icon electron/windowsAssets/app.ico \
		--out builds \
		--arch x64 \
		--asar \
		$(ELECTRON_IGNORES)

electron-darwin:
	$(NPATH)/electron-packager . \
		--overwrite \
		--platform darwin \
		--icon images/app.icns \
		--out builds \
		--appBundleId io.forsta.messenger \
		$(ELECTRON_IGNORES)

electron-mas:
	$(NPATH)/electron-packager . \
		--overwrite \
		--platform mas \
		--prune true\
		--icon images/app.icns \
		--asar \
		--arch x64 \
		--out builds \
		--appBundleId io.forsta.messenger \
		$(ELECTRON_IGNORES)

electron-linux:
	$(NPATH)/electron-packager . \
		--overwrite \
		--platform linux \
		--icon images/app.png \
		--out builds \
		$(ELECTRON_IGNORES)

electron-osx-sign:
	electron/sign_mas.sh

docker-build:
	docker build -t relay-web-app .

docker-run:
	docker run -it -p 1080:1080 relay-web-app

.PHONY: electron docker-build docker-run
