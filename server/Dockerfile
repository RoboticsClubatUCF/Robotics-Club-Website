# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# The client is generated per-image rather than committed, so it always matches
# the schema in this build. Runs as root because /app is root-owned.
RUN npx prisma generate

USER node
EXPOSE 4000

# tsx runs the TypeScript directly. That keeps devDependencies in the image,
# which is a fair trade at this size — swap in a tsc build step if the image
# footprint ever matters.
CMD ["npx", "tsx", "src/index.ts"]
