FROM oven/bun:1.3.13

WORKDIR /app

# Use Debian system packages for numpy + scipy — pre-compiled, no build tools needed
# ffmpeg for audio mixing and format conversion
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    python3 \
    python3-numpy \
    python3-scipy \
    ffmpeg \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy dependency files first for better layer caching
COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

# Copy source + audio analysis script
COPY . .

EXPOSE 4000

CMD ["bun", "run", "src/index.ts"]
