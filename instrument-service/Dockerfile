# Deterministic build for the PANNs instrument tagger. A Dockerfile (vs Railway's
# Railpack/Nixpacks autodetect) pins Python 3.11 — torch 2.2.2 has cp311 wheels
# but NOT 3.13 — and guarantees ffmpeg is present for mp3/m4a decode.
FROM python:3.11-slim

WORKDIR /app

# ffmpeg — librosa needs it to decode mp3/m4a (WAV/FLAC work without it).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway injects $PORT at runtime.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
