# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim

WORKDIR /app/service

# better-sqlite3 may compile from source on linux/arm64.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY service/package.json ./package.json
RUN npm install --omit=dev

COPY service/src ./src
COPY service/db ./db

RUN chown -R node:node /app/service
USER node

ENV NODE_ENV=production
ENV PORT=8080
ENV DATABASE_FILE=./db/laundry.sqlite

EXPOSE 8080

CMD ["node", "src/app.js"]
