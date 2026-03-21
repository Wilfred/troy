# Build stage
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Production stage
FROM node:22-slim
WORKDIR /app

ARG COMMIT_HASH=""
ARG COMMIT_DATE=""
ARG COMMIT_MESSAGE=""
RUN if [ -n "$COMMIT_HASH" ]; then \
      node -e "process.stdout.write(JSON.stringify({hash:process.argv[1],date:process.argv[2],message:process.argv[3]}))" \
        "$COMMIT_HASH" "$COMMIT_DATE" "$COMMIT_MESSAGE" > commit-info.json; \
    fi

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/ dist/
COPY src/SYSTEM.md src/
ENTRYPOINT ["node", "dist/index.js"]
CMD ["discord"]
