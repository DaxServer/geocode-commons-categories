FROM oven/bun:1.3.11

WORKDIR /app

COPY . .

EXPOSE 3000

CMD ["bun", "packages/backend/src/index.ts"]
