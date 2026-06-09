# Dizko instrument tagger — PANNs (Cnn14 / AudioSet)

Identifies a stem's instrument from the **audio** using PANNs, trained on
AudioSet's 527 classes. Unlike coarse APIs (Music.AI's 8 buckets) or zero-shot
CLAP (soft cosine guesses), PANNs gives **fine-grained, real trained classes**
with meaningful sigmoid confidences: electric guitar, acoustic guitar, bass,
violin/cello → strings, piano, organ, synth, **bass drum (kick), snare, hi-hat,
cymbal**, brass, winds, vocals.

**This is the recommended worker** (it supersedes the parked `clap-service/`,
which gave unreliable flat scores). The backend client (`instrumentTagging.ts`)
is model-agnostic — it just calls `/classify`, so this drops straight in.

## API

```
GET  /health
POST /classify   { "audio_url": "https://...wav", "top_k": 3 }
  -> { "instrument": "Acoustic Guitar", "confidence": 0.61,
       "ranked": [ { "label": "Acoustic Guitar", "score": 0.61 }, ... ] }
```

Send `Authorization: Bearer <INSTRUMENT_AUTH_TOKEN>` if the token is set.

## Deploy to Railway (no local Docker)

1. **New → Deploy from repo**, set **Root Directory** to `instrument-service/`.
   Nixpacks auto-detects Python from `requirements.txt` and runs the `Procfile`.
2. **Memory: ~2 GB** (Cnn14 checkpoint ~300 MB + torch). First boot downloads the
   model — `/health` answers once it's loaded.
3. **Env var:** `INSTRUMENT_AUTH_TOKEN` — a shared secret; set the SAME value on
   the Dizko backend. (`MAX_SECONDS` optional, default 20.)
4. Grab the service URL → set on the **backend** as `INSTRUMENT_SERVICE_URL`
   (+ matching `INSTRUMENT_AUTH_TOKEN`). Until set, the backend tagger is a no-op.

## Notes
- **WAV/FLAC work out of the box.** MP3/M4A need `ffmpeg` on the image — add it via
  a Railway/nixpacks apt package if you accept those formats.
- Confidences are real sigmoid probabilities (0–1), so the backend's threshold is
  meaningful — tune it in `instrumentTagging.ts`.
- **Kick vs snare:** PANNs has `Bass drum`/`Snare drum`/`Hi-hat` classes, so it
  *attempts* kit pieces — but for top accuracy there, a dedicated drum one-shot
  classifier (trained on labeled sample packs) is the eventual ceiling.
