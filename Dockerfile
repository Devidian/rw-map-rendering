FROM node:24-slim AS builder

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable
RUN corepack yarn install --immutable

COPY tsconfig.json .
COPY src ./src

RUN corepack yarn build

FROM node:24-slim

WORKDIR /app
ENV MAP_ROOT_DIR=/appdata/rw-map-rendering/tiles
ENV POLL_INTERVAL_MS=15000
ENV PORT=3000
ENV HOST=0.0.0.0
ENV RENDER_SERVERS_CONFIG_FILE=/app/config/server-config.json
ENV RSYNC_TARGET=
ENV RSYNC_SSH_KEY_FILE=
ENV PUBLISH_MODE=raw
ENV ARCHIVE_ROOT_DIR=
ENV SFTP_TARGET=
ENV SFTP_CONFIG_FILE=/app/config/rclone.conf
ENV SFTP_IDLE_SYNC_MS=300000
ENV SFTP_FULL_SYNC_MS=3600000
ENV LOG_LEVEL=info

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client rsync rclone \
  && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable
RUN corepack yarn workspaces focus --production

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
