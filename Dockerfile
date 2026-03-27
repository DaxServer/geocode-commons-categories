# Stage 1: Install dependencies
FROM oven/bun:1.3.11 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Stage 2: Build (for future compilation needs)
FROM oven/bun:1.3.11 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Stage 3: Production runtime
FROM oven/bun:1.3.11 AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy dependencies and source
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/package.json ./

EXPOSE 3000

CMD ["bun", "src/index.ts"]
