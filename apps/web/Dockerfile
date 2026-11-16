FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
RUN npm ci
COPY apps/web apps/web
COPY packages packages
ARG CONVIYA_API_URL=http://api:8000
ENV CONVIYA_API_URL=$CONVIYA_API_URL
RUN npm run build && npm prune --omit=dev

FROM node:24.19.0-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 CONVIYA_API_URL=http://api:8000
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["../../node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
WORKDIR /app/apps/web
