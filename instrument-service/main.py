# Dizko instrument tagger — PANNs (Cnn14, AudioSet) fine-grained instrument ID.
#
# Identifies the instrument in a stem from the AUDIO, using PANNs trained on
# AudioSet's 527 classes — which include FINE-GRAINED instruments the coarse
# APIs miss: electric guitar, acoustic guitar, bass, violin, piano, organ,
# synth, snare drum, bass drum (kick), hi-hat, cymbal, brass, etc.
#
# Unlike zero-shot CLAP, these are REAL trained classes with sigmoid
# probabilities, so confidence scores are meaningful and thresholdable.
#
#   POST /classify  { "audio_url": "https://...wav", "top_k": 3 }
#   -> { "instrument": "Acoustic Guitar", "confidence": 0.61, "ranked": [...] }

import os
import tempfile
from typing import Optional

import requests
import librosa
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from panns_inference import AudioTagging, labels as AUDIOSET_LABELS

AUTH_TOKEN  = os.environ.get("INSTRUMENT_AUTH_TOKEN")     # shared secret the backend sends
SR          = 32_000                                     # PANNs Cnn14 expects 32 kHz mono
MAX_SECONDS = float(os.environ.get("MAX_SECONDS", "10"))   # 10s is plenty to ID an instrument; faster under load

# AudioSet class keyword -> Dizko clean label (matches backend INSTRUMENT_MAP).
# Order matters: most specific first ("bass drum" before "drum", "electric
# guitar" before "guitar"), so the first keyword that matches wins.
KEYWORD_MAP = [
    ("electric guitar", "Guitar"),
    ("acoustic guitar", "Acoustic Guitar"),
    ("bass guitar",     "Bass"),
    ("guitar",          "Guitar"),
    ("violin",          "Strings"), ("fiddle", "Strings"), ("cello", "Strings"),
    ("viola",           "Strings"), ("string section", "Strings"), ("orchestra", "Strings"),
    ("electric piano",  "Keys"),
    ("piano",           "Piano"),
    ("organ",           "Organ"),
    ("synthesizer",     "Synth"),
    ("snare",           "Snare"),
    ("bass drum",       "Kick"),
    ("hi-hat",          "Hi-Hat"),
    ("cymbal",          "Cymbal"),
    ("drum kit",        "Drums"), ("drum machine", "Drums"), ("percussion", "Percussion"), ("drum", "Drums"),
    ("trumpet", "Brass"), ("trombone", "Brass"), ("saxophone", "Brass"),
    ("french horn", "Brass"), ("brass", "Brass"),
    ("flute", "Wind"), ("clarinet", "Wind"), ("oboe", "Wind"), ("wind", "Wind"),
    ("singing", "Vocals"), ("vocal", "Vocals"), ("choir", "Vocals"), ("speech", "Vocals"),
]

# Precompute {audioset_index: clean_label} once at startup.
INDEX_TO_LABEL = {}
for _i, _name in enumerate(AUDIOSET_LABELS):
    _low = _name.lower()
    for _kw, _clean in KEYWORD_MAP:
        if _kw in _low:
            INDEX_TO_LABEL[_i] = _clean
            break

app = FastAPI(title="Dizko PANNs instrument tagger")

print("[panns] loading Cnn14 (downloads ~300 MB on first boot)...", flush=True)
tagger = AudioTagging(checkpoint_path=None, device="cpu")
print(f"[panns] ready — {len(INDEX_TO_LABEL)} AudioSet instrument classes mapped", flush=True)


class ClassifyReq(BaseModel):
    audio_url: str
    top_k: int = 3


@app.get("/health")
def health():
    return {"status": "ok", "model": "PANNs Cnn14", "instrument_classes": len(INDEX_TO_LABEL)}


@app.post("/classify")
def classify(req: ClassifyReq, authorization: Optional[str] = Header(None)):
    if AUTH_TOKEN and authorization != f"Bearer {AUTH_TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")

    try:
        resp = requests.get(req.audio_url, timeout=60)
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"download failed: {e}")

    try:
        with tempfile.NamedTemporaryFile(suffix=".audio") as tmp:
            tmp.write(resp.content)
            tmp.flush()
            audio, _ = librosa.load(tmp.name, sr=SR, mono=True, duration=MAX_SECONDS)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"decode failed (mp3/m4a may need ffmpeg): {e}")

    clipwise, _ = tagger.inference(audio[None, :])    # (1, 527) independent sigmoid probs
    scores = clipwise[0]

    # Aggregate to clean labels: take the max prob across each label's AudioSet classes.
    agg: dict[str, float] = {}
    for idx, clean in INDEX_TO_LABEL.items():
        s = float(scores[idx])
        if s > agg.get(clean, 0.0):
            agg[clean] = s

    ranked = sorted(agg.items(), key=lambda kv: -kv[1])[: max(1, req.top_k)]
    top = [{"label": l, "score": round(s, 4)} for l, s in ranked]
    return {"instrument": top[0]["label"], "confidence": top[0]["score"], "ranked": top}
