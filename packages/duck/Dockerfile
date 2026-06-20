# Dockerfile for the Duck bot.
# Build from the repository root so the build context includes the shared
# and history packages:  docker build -f packages/duck/Dockerfile -t duck .

# Build stage
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/history/package.json packages/history/
COPY packages/troy/package.json packages/troy/
COPY packages/duck/package.json packages/duck/
# Install only the Duck workspace (+ root dev tooling such as tsc).
RUN npm ci -w @troy/duck --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/history packages/history
COPY packages/duck packages/duck
RUN npx tsc -b packages/duck

# Production stage
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/history/package.json packages/history/
COPY packages/troy/package.json packages/troy/
COPY packages/duck/package.json packages/duck/
RUN npm ci --omit=dev -w @troy/duck --include-workspace-root=false
COPY --from=build /app/packages/shared/dist/ packages/shared/dist/
COPY --from=build /app/packages/history/dist/ packages/history/dist/
COPY --from=build /app/packages/duck/dist/ packages/duck/dist/

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "packages/duck/dist/index.js"]
