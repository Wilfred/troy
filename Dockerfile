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
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/ dist/
COPY src/SYSTEM.md src/
COPY .git .git
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/healthz',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

ENTRYPOINT ["node", "dist/index.js"]
CMD ["discord"]
