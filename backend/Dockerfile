FROM oven/bun:1.3.13

WORKDIR /app

# ffmpeg — required by Smart Mix (smartBounce) and cover/avatar image conversion.
# Without it, smartBounce fails with "ffmpeg: not found" in production.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

# cache-bust: 2026-05-20
COPY . .

EXPOSE 4000

CMD ["bun", "src/index.ts"]
