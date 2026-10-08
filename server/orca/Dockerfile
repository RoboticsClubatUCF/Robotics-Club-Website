# syntax=docker/dockerfile:1
#
# The slicer worker: Node and the pinned OrcaSlicer CLI, on the Ubuntu its AppImage was built for.
# Built from server/ (`docker build -f orca/Dockerfile .`). The API image stays on Alpine and never
# contains Orca.
#
# Changing the Orca version means changing both ARGs. The worker resolves every officer-uploaded
# profile again against the new release's stock profiles when it starts.

ARG ORCA_VERSION=2.4.2
ARG ORCA_SHA256=d12fb8c8eac1aecd2dfb6377acd48f994f8fa439ed5292fa532dd82880f029fd

FROM ubuntu:24.04 AS orca
ARG ORCA_VERSION
ARG ORCA_SHA256
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /tmp/orca
# Pinned by checksum, never `latest`. Extracted rather than mounted, so no FUSE.
RUN curl -fsSL -o orca.AppImage \
      "https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v${ORCA_VERSION}/OrcaSlicer_Linux_AppImage_Ubuntu2404_V${ORCA_VERSION}.AppImage" \
 && echo "${ORCA_SHA256}  orca.AppImage" | sha256sum -c - \
 && chmod +x orca.AppImage \
 && ./orca.AppImage --appimage-extract > /dev/null \
 && mv squashfs-root /opt/orca \
 && rm orca.AppImage

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npx prisma generate

FROM ubuntu:24.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive
# What the 2.4.2 binary links against. No X server: the CLI slices and exports without a display.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates libgl1 libegl1 libglu1-mesa libopengl0 libglx0 libgl1-mesa-dri \
      libsm6 libice6 libx11-6 libxext6 libxkbcommon0 \
      libgtk-3-0t64 libwebkit2gtk-4.1-0 libjavascriptcoregtk-4.1-0 libsoup-3.0-0 libsecret-1-0 \
      libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 libmspack0t64 libdbus-1-3 libfontconfig1 \
      libwayland-client0 libwayland-egl1 libwayland-server0 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=orca /opt/orca /opt/orca

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY --from=deps /app/src/generated ./src/generated
# The club's own exports, which the smoke test resolves the way the worker resolves an upload.
COPY orca/source ./orca/source
COPY orca/fixtures ./orca/fixtures
COPY orca/NOTICE.md ./orca/NOTICE.md

# Its own user; the only writable places are the tmpfs mounts compose gives it.
RUN useradd --system --uid 10001 --no-create-home --home-dir /nonexistent slicer \
 && mkdir -p /scratch \
 && chown slicer /scratch

ENV NODE_ENV=production \
    ORCA_BINARY=/opt/orca/bin/orca-slicer \
    SLICER_SCRATCH_DIR=/scratch

# deploy.sh prunes dangling images by this label, never the club's other services.
LABEL org.rccf.service=slicer

USER slicer
# Healthy while the heartbeat file is under a minute old.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "const s=require('fs').statSync('/scratch/heartbeat');process.exit(Date.now()-s.mtimeMs<60000?0:1)"
CMD ["node", "--import", "tsx", "src/worker.ts"]
