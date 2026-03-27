FROM oven/bun:1.3.11
WORKDIR /app
ENV NODE_ENV=production

COPY . .

EXPOSE 3000

CMD ["bun", "src/index.ts"]
