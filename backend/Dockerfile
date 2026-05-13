FROM oven/bun:1.3.13

WORKDIR /app

# Install Python3 + ffmpeg + BPM/key analysis deps (numpy + scipy, no heavy ML)
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg \
    && pip3 install --quiet --no-cache-dir numpy scipy \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy dependency files first for better layer caching
COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

# Copy source + audio analysis script
COPY . .

EXPOSE 4000

CMD ["bun", "run", "src/index.ts"]
