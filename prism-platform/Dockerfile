# PRISM Platform Multi-Stage Production Containerfile
FROM node:24-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3300
ENV NODE_ENV=production
EXPOSE 3300

USER node
CMD ["node", "src/server.js"]
