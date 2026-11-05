FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node server/ ./server/
COPY --chown=node:node src/coaching/ ./src/coaching/
COPY --chown=node:node src/server/client.js ./src/server/client.js
COPY --chown=node:node scripts/write-build-info.mjs ./scripts/write-build-info.mjs
ARG ATHLIMA_BUILD_VERSION=development
ARG ATHLIMA_BUILD_REVISION=
RUN node scripts/write-build-info.mjs server/build-info.json
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]
