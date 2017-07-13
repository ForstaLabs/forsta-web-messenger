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

#build: $(BUILD)
build: 
	find / -type d -maxdepth 4 || true
	pwd
	git rev-parse HEAD || true
	cd /app && git rev-parse HEAD

$(BUILD): $(GRUNT) $(TEST) Makefile
	@echo '{' > $@
	@echo '  "git_commit": "$(shell git rev-parse HEAD)",' >> $@
	@echo '  "git_tag": "$(shell git name-rev --tags --name-only $(shell git rev-parse HEAD) | grep -v undefined)",' >> $@
	@echo '  "git_branch": "$(shell git rev-parse --abbrev-ref HEAD)",' >> $@
	@echo '  "git_repo": "$(shell git config --get remote.origin.url)",' >> $@
	@echo '  "git_rev_count": $(shell git rev-list --count HEAD),' >> $@
	@echo '  "build_ident": "$(USER)@$(shell hostname)",' >> $@
	@echo '  "build_datetime": "$(shell date +%Y-%m-%dT%H:%M:%S%z)"' >> $@
	@echo '}' >> $@
	@echo Wrote $@

clean:
	rm -rf $(PACKAGES) $(SEMANTIC) $(BOWER) $(GRUNT) dist

realclean: clean
	rm -rf node_modules components


########################################################
# Runtime-only targets
########################################################
watch:
	$(NPATH)/grunt watch

run: $(BUILD)
	node server/start.js

forcerun:
	node server/start.js
