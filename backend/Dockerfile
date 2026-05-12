FROM oven/bun:1.3.13

WORKDIR /app

# Copy dependency files first for better layer caching
COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

# Copy source
COPY . .

EXPOSE 4000

CMD ["bun", "run", "src/index.ts"]
