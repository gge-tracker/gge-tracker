# syntax = docker/dockerfile:1

ARG NODE_VERSION=19.0.0
FROM node:${NODE_VERSION}-slim as build

LABEL fly_launch_runtime="NodeJS"

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -qq && \
    apt-get install -y python-is-python3 pkg-config build-essential

COPY src .
COPY package*.json ./

RUN if [ ! -f config/credentials.json ] || [ ! -f config/instances.json ]; then echo "Error: config/credentials.json and/or config/instances.json not found!"; exit 1; fi

ARG HAS_GBL
RUN if [ "${HAS_GBL}" = "true" ]; then \
    cp config/credentials_gbl.json config/credentials.json && \
    cp config/instances_gbl.json config/instances.json; \
fi

RUN npm install --omit=dev

FROM node:${NODE_VERSION}-alpine

RUN apk add --no-cache \
    chromium \
    xvfb \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    bash \
    dbus \
    udev \
    curl \
    && rm -rf /var/cache/apk/*

ENV CHROME_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production

WORKDIR /app
COPY --from=build /app /app
RUN npm install --omit=dev

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT [ "docker-entrypoint.sh" ]
CMD [ "npm", "run", "start" ]
