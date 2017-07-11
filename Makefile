default: build

PACKAGES := node_modules/.packages.build
SEMANTIC := semantic/dist/.semantic.build
BOWER := components/.bower.build
GRUNT := dist/.grunt.build

packages: $(PACKAGES)
semantic: $(SEMANTIC)
bower: $(BOWER)
grunt: $(GRUNT)

NPATH := $(shell pwd)/node_modules/.bin

########################################################
# Building & cleaning targets
########################################################

ifdef GITHUB_AUTH_TOKEN
bowerauth:
	git config --global credential.helper "$$PWD/.heroku_env_auth"
else
bowerauth:
endif

$(PACKAGES): package.json
	npm install
	touch $@

$(SEMANTIC): $(PACKAGES) $(shell find semantic/src -type f)
	cd semantic && $(NPATH)/gulp build
	touch $@

$(BOWER): $(PACKAGES) bower.json bowerauth
	$(NPATH)/bower install
	touch $@

$(GRUNT): $(BOWER) $(SEMANTIC) Gruntfile.js $(shell find app lib stylesheets -type f) lint
	$(NPATH)/grunt default
	touch $@

build: $(GRUNT)

clean:
	rm -rf $(PACKAGES) $(SEMANTIC) $(BOWER) $(GRUNT) dist

realclean: clean
	rm -rf node_modules components

ifneq ($(NODE_ENV),production)
lint: $(BOWER)
	$(NPATH)/eslint app lib
else
lint:
endif


########################################################
# Runtime-only targets
########################################################
watch:
	$(NPATH)/grunt watch

run: build
	node server/start.js

forcerun:
	node server/start.js

test:
	node tests/forstaDownTest.js