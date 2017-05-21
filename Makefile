default: build

PACKAGES := .packages.build
SEMANTIC := .semantic.build
BOWER := .bower.build
GRUNT := .grunt.build

packages: $(PACKAGES)
semantic: $(SEMANTIC)
bower: $(BOWER)
grunt: $(GRUNT)

export PATH := $(shell pwd)/node_modules/.bin:$(PATH)

########################################################
# Building & cleaning targets
########################################################

$(PACKAGES): package.json
	npm install
	touch $@

$(SEMANTIC): $(PACKAGES) $(shell find semantic/src -type f)
	cd semantic && gulp build
	touch $@

$(BOWER): $(PACKAGES) bower.json
	bower install
	touch $@

$(GRUNT): $(BOWER) $(SEMANTIC) Gruntfile.js $(shell find app stylesheets -type f)
	grunt default
	touch $@

build: $(GRUNT)

clean:
	rm -f $(PACKAGES) $(SEMANTIC) $(BOWER) $(GRUNT)

real-clean: clean
	rm -rf node_modules components dist


########################################################
# Runtime-only targets
########################################################
watch:
	grunt watch

run: build
	node --harmony-async-await server/start.js
