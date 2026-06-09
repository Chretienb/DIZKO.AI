# Dizko CLAP instrument tagger

A tiny zero-shot audio classifier that identifies the instrument in a stem from
the **audio itself** (not the filename), using LAION's music-tuned CLAP
(`laion/larger_clap_music`). The backend calls it as a fallback when a user
didn't pick an instrument and the filename is useless (`track_03.wav`).

## API

```
GET  /health
POST /classify   { "audio_url": "https://...wav", "top_k": 3 }
  -> { "instrument": "Acoustic Guitar", "confidence": 0.62,
       "ranked": [ { "label": "Acoustic Guitar", "score": 0.62 }, ... ] }
```

Send `Authorization: Bearer <CLAP_AUTH_TOKEN>` if the token is configured.

## Deploy to Railway (no local Docker needed)

1. Push this repo. In Railway: **New → Deploy from repo**, set **Root Directory**
   to `clap-service/`. Nixpacks auto-detects Python from `requirements.txt` and
   runs the `Procfile`.
2. **Memory:** the model + CPU torch need **~3 GB RAM** resident. Give the
   service a plan with at least that (it OOM-crashes on the 512 MB default).
   First boot downloads the model (~1.5 GB) — give it a minute before the first
   request; `/health` tells you when it's up.
3. **Env vars:**
   - `CLAP_AUTH_TOKEN` — a shared secret; set the SAME value on the Dizko backend.
   - `CLAP_MODEL` (optional) — defaults to `laion/larger_clap_music`.
   - `CLAP_MAX_SECONDS` (optional) — window length to analyze (default 20s).
4. Grab the service's public URL and set it on the **backend** as
   `CLAP_SERVICE_URL` (+ the matching `CLAP_AUTH_TOKEN`). Until that's set, the
   backend tagger is a no-op and nothing changes.

## Notes
- **WAV/FLAC work out of the box.** MP3/M4A decoding needs `ffmpeg` on the image
  — add it via a Railway/nixpacks apt package if you accept those formats.
- CPU inference on a ~20s clip is a few seconds — fine for the background
  analysis step (it's not on the upload's critical path).
- Tune the confidence threshold on the backend side (`instrumentTagging.ts`).
