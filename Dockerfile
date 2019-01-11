FROM node:10
ENV LC_ALL=C.UTF-8 \
    NODE_ENV=production
RUN apt-get update && \
    apt-get install -y ruby ruby-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
RUN gem install sass
WORKDIR /usr/src
COPY Makefile package.json bower.json semantic.json .bowerrc .npmrc ./
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
COPY worker worker
COPY Gemfile Gemfile.lock Gruntfile.js manifest.json ./
RUN make build
EXPOSE 1080
CMD ["npm", "start"]
