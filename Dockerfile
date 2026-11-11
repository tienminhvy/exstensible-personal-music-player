# Lightweight app image: multi-stage (deps -> build -> runtime),
# alpine-class base, production-only deps, non-root user. ffmpeg + python3
# exist only in the runtime stage: yt-dlp ships as a self-contained
# python zipapp in youtube-dl-exec/bin, and extraction needs ffmpeg.
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run prepare \
    && npx prisma generate \
    && npm run build \
    && npm prune --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache ffmpeg python3

COPY --from=build --chown=node:node /app/build build
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY prisma prisma
COPY prisma.config.ts package.json ./

USER node

EXPOSE 3000

CMD ["node", "build/index.js"]
