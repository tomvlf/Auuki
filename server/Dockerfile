FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node server/ ./server/
COPY --chown=node:node src/coaching/ ./src/coaching/
COPY --chown=node:node src/server/client.js ./src/server/client.js
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]
