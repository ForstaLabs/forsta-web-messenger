default: build

PACKAGES := node_modules/.packages.build
SEMANTIC := semantic/dist/.semantic.build
BOWER := components/.bower.build
GRUNT := dist/.grunt.build
LINT := .lint.pass
TEST := .test.pass
BUILD := dist/build.json

packages: $(PACKAGES)
semantic: $(SEMANTIC)
bower: $(BOWER)
grunt: $(GRUNT)

NPATH := $(shell pwd)/node_modules/.bin
SRC := $(shell find app lib stylesheets -type f)

########################################################
# Building & cleaning targets
########################################################

$(PACKAGES): package.json
	npm install
	touch $@

$(SEMANTIC): $(PACKAGES) $(shell find semantic/src -type f)
	cd semantic && $(NPATH)/gulp build
	touch $@

$(BOWER): $(PACKAGES) bower.json Makefile
	if [ -n "$$GITHUB_AUTH_TOKEN" ] ; then \
	    git config --global credential.helper "$$PWD/.heroku_env_auth"; \
	fi
	$(NPATH)/bower install
	touch $@

ifneq ($(NODE_ENV),production)
$(LINT): $(SRC)
	$(NPATH)/eslint app lib
	touch $@

$(TEST): $(SRC) $(shell find tests -type f)
	node tests/forstaDownTest.js
	touch $@
else
$(LINT):
	touch $@

$(TEST):
	touch $@
endif

$(GRUNT): $(BOWER) $(SEMANTIC) Gruntfile.js $(SRC) $(LINT) Makefile
	$(NPATH)/grunt default
	touch $@

$(BUILD): $(GRUNT) $(TEST) Makefile
	echo '{"git_commit": "$(or $(SOURCE_VERSION),$(shell git rev-parse HEAD))"}' > $@

clean:
	rm -rf $(PACKAGES) $(SEMANTIC) $(BOWER) $(GRUNT) dist

realclean: clean
	rm -rf node_modules components

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
