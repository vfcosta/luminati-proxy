#
# luminati-proxy Dockerfile
#
# https://github.com/luminati-io/luminati-proxy
#

# Pull base image.
FROM node:10.11.0

USER root
RUN npm config set user root
RUN npm install -g npm@6.4.1

# Install Luminati Proxy Manager
ENV APP_DIR /opt/luminati-proxy
WORKDIR ${APP_DIR}
COPY package.json ${APP_DIR}/package.json
RUN npm install
COPY . ${APP_DIR}
RUN npm install -g ${APP_DIR}

# Mark environment as Docker for CLI output
ENV DOCKER 1

# Define default command.
CMD ["luminati", "--help"]
