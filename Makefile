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

$(PACKAGES): package.json
	npm install
	touch $@

$(SEMANTIC): $(PACKAGES) $(shell find semantic/src -type f)
	cd semantic && $(NPATH)/gulp build
	touch $@

$(BOWER): $(PACKAGES) bower.json
	$(NPATH)/bower install
	touch $@

$(GRUNT): $(BOWER) $(SEMANTIC) Gruntfile.js $(shell find app stylesheets -type f)
	$(NPATH)/grunt default
	touch $@

build: $(GRUNT)

clean:
	rm -f $(PACKAGES) $(SEMANTIC) $(BOWER) $(GRUNT)

realclean: clean
	rm -rf node_modules components dist


########################################################
# Runtime-only targets
########################################################
watch:
	$(NPATH)/grunt watch

run: build
	node server/start.js
