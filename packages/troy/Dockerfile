# Dockerfile for the Troy bot.
# Build from the repository root so the build context includes the whole
# workspace:  docker build -f packages/troy/Dockerfile -t troy .

# Build stage
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/troy/package.json packages/troy/
COPY packages/duck/package.json packages/duck/
# Install only the Troy workspace (+ root dev tooling such as tsc).
RUN npm ci -w troy --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/troy packages/troy
RUN npx tsc -b packages/troy \
  && cp -r packages/troy/src/public packages/troy/dist/public

# Production stage
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/troy/package.json packages/troy/
COPY packages/duck/package.json packages/duck/
RUN npm ci --omit=dev -w troy --include-workspace-root=false
COPY --from=build /app/packages/shared/dist/ packages/shared/dist/
COPY --from=build /app/packages/troy/dist/ packages/troy/dist/
# SYSTEM.md and the code-search tool read from the source tree at runtime.
COPY packages/troy/src/ packages/troy/src/
COPY .git .git
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/healthz',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "packages/troy/dist/index.js", "discord"]
