# Dockerfile for the minimal Duck bot.
# Build from the repository root so the build context includes the shared
# package:  docker build -f packages/duck/Dockerfile -t duck .
#
# Duck only depends on discord.js, @openrouter/sdk and @troy/shared, so this
# image stays slim and never installs Troy's heavier dependencies (typeorm,
# better-sqlite3, googleapis, ...).

# Build stage
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/troy/package.json packages/troy/
COPY packages/duck/package.json packages/duck/
# Install only the Duck workspace (+ root dev tooling such as tsc).
RUN npm ci -w @troy/duck --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/duck packages/duck
RUN npx tsc -b packages/duck

# Production stage
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/troy/package.json packages/troy/
COPY packages/duck/package.json packages/duck/
RUN npm ci --omit=dev -w @troy/duck --include-workspace-root=false
COPY --from=build /app/packages/shared/dist/ packages/shared/dist/
COPY --from=build /app/packages/duck/dist/ packages/duck/dist/

CMD ["node", "packages/duck/dist/index.js"]
