FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/browser/package.json apps/browser/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci
COPY . .
RUN npm run db:generate && npm run build
ENV NODE_ENV=production
USER node
EXPOSE 3000 4000
CMD ["node","apps/api/dist/main.js"]
