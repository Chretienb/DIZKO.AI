# Deterministic build for the PANNs instrument tagger. A Dockerfile (vs Railway's
# Railpack/Nixpacks autodetect) pins Python 3.11 — torch 2.2.2 has cp311 wheels
# but NOT 3.13 — and guarantees ffmpeg is present for mp3/m4a decode.
FROM python:3.11-slim

WORKDIR /app

# ffmpeg — librosa needs it to decode mp3/m4a (WAV/FLAC work without it).
# curl — to pre-fetch the panns label file below.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# panns_inference reads these at import / model-init and does NOT reliably
# auto-download them in a fresh container → boot crash. Pre-bake both:
#   - class_labels_indices.csv (read at import)
#   - Cnn14_mAP=0.431.pth      (the ~312 MB model checkpoint, torch.load'd at init)
RUN mkdir -p /root/panns_data \
  && curl -fSL -o /root/panns_data/class_labels_indices.csv \
     http://storage.googleapis.com/us_audioset/youtube_corpus/v1/csv/class_labels_indices.csv \
  && curl -fSL -o "/root/panns_data/Cnn14_mAP=0.431.pth" \
     "https://zenodo.org/record/3987831/files/Cnn14_mAP%3D0.431.pth?download=1"

COPY . .

# Railway injects $PORT at runtime.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
