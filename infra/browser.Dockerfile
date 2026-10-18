FROM mcr.microsoft.com/playwright:v1.64.0-noble
USER root
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/browser/package.json apps/browser/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/browser apps/browser
RUN npm run build -w @sitescope/core && npm run build -w @sitescope/browser
ENV NODE_ENV=production
ENV PORT=4100
ENV HOME=/tmp
USER pwuser
EXPOSE 4100
CMD ["node","apps/browser/dist/main.js"]

