FROM node:10
RUN apt-get update && \
    apt-get install -y ruby ruby-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
RUN gem install sass
WORKDIR /usr/src
COPY . .
ENV LC_ALL=C.UTF-8
RUN make
EXPOSE 1080
CMD ["make", "run"]
