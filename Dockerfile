FROM node:10
ENV LC_ALL=C.UTF-8 \
    NODE_ENV=production
RUN apt-get update && \
    apt-get install -y \
        ruby \
        ruby-dev \
        libx11-xcb1 \
        libxtst6 \
        libnss3 \
        libxss1 \
        libasound2 \
        libatk-bridge2.0 \
        libgtk-3.0 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
RUN gem install sass
WORKDIR /usr/src
COPY Makefile package.json bower.json semantic.json .bowerrc .npmrc .eslintrc.json ./
COPY semantic/gulpfile.js semantic/
COPY semantic/src semantic/src
COPY semantic/tasks semantic/tasks
RUN make packages bower semantic
COPY app app
COPY audio audio
COPY fonts fonts
COPY html html
COPY images images
COPY lib lib
COPY server server
COPY stylesheets stylesheets
COPY templates templates
COPY tests tests
COPY worker worker
COPY .git .git
COPY Gemfile Gemfile.lock Gruntfile.js manifest.json ./
ARG source_version
ARG build_target=build
ENV SOURCE_VERSION=$source_version
RUN make $build_target
EXPOSE 1080
CMD ["npm", "start"]
