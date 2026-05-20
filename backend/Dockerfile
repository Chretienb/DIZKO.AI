FROM oven/bun:1.3.13

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

# cache-bust: 2026-05-20
COPY . .

EXPOSE 4000

CMD ["bun", "src/index.ts"]
