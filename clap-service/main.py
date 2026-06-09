# Dizko CLAP instrument tagger — a tiny zero-shot audio classifier.
#
# Identifies the instrument in a stem from the AUDIO itself (not the filename),
# using LAION's music-tuned CLAP. The backend calls this as a fallback whenever
# a user didn't pick an instrument and the filename is useless ("track_03.wav").
#
# Zero-shot: we score the audio against descriptive prompts and return the best
# matching instrument label (aligned to the backend's INSTRUMENT_MAP).
#
#   POST /classify  { "audio_url": "https://...wav", "top_k": 3 }
#   ->  { "instrument": "Acoustic Guitar", "confidence": 0.62, "ranked": [...] }

import os
import tempfile
from typing import Optional

import requests
import librosa
import torch
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from transformers import ClapModel, ClapProcessor

MODEL_ID    = os.environ.get("CLAP_MODEL", "laion/larger_clap_music")
AUTH_TOKEN  = os.environ.get("CLAP_AUTH_TOKEN")          # shared secret the backend sends
TARGET_SR   = 48_000                                     # CLAP expects 48 kHz mono
MAX_SECONDS = float(os.environ.get("CLAP_MAX_SECONDS", "20"))   # tag a representative window

# Descriptive prompts beat bare labels for zero-shot accuracy (ReCLAP finding).
# Keys are the clean labels the backend's INSTRUMENT_MAP already uses.
LABEL_PROMPTS = {
    "Kick":            "a punchy deep kick drum",
    "Snare":           "a sharp cracking snare drum",
    "Hi-Hat":          "crisp ticking hi-hat cymbals",
    "Drums":           "a full acoustic drum kit groove",
    "Percussion":      "hand percussion like congas, bongos and shakers",
    "Bass":            "a deep electric bass guitar holding the low end",
    "Acoustic Guitar": "a bright plucked acoustic guitar",
    "Guitar":          "a distorted electric guitar",
    "Piano":           "an acoustic grand piano",
    "Keys":            "an electric piano or rhodes keyboard",
    "Synth":           "a bright synthesizer lead",
    "Pad":             "a warm sustained synth pad",
    "Organ":           "a hammond organ",
    "Strings":         "an orchestral string section",
    "Brass":           "a brass horn section with trumpets and saxophone",
    "Vocals":          "a person singing vocals",
}
LABELS  = list(LABEL_PROMPTS.keys())
PROMPTS = list(LABEL_PROMPTS.values())

app = FastAPI(title="Dizko CLAP instrument tagger")

print(f"[clap] loading {MODEL_ID} (one-time, ~download on first boot)...", flush=True)
model = ClapModel.from_pretrained(MODEL_ID)
processor = ClapProcessor.from_pretrained(MODEL_ID)
model.eval()
# Pre-compute the text embeddings once — they never change, so every request
# only has to embed the audio.
with torch.no_grad():
    _text_inputs = processor(text=PROMPTS, return_tensors="pt", padding=True)
    TEXT_EMB = torch.nn.functional.normalize(model.get_text_features(**_text_inputs), dim=-1)
print("[clap] ready", flush=True)


class ClassifyReq(BaseModel):
    audio_url: str
    top_k: int = 3


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_ID, "labels": len(LABELS)}


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
            audio, _ = librosa.load(tmp.name, sr=TARGET_SR, mono=True, duration=MAX_SECONDS)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"decode failed (mp3/m4a may need ffmpeg): {e}")

    with torch.no_grad():
        audio_inputs = processor(audios=[audio], return_tensors="pt", sampling_rate=TARGET_SR)
        audio_emb = torch.nn.functional.normalize(model.get_audio_features(**audio_inputs), dim=-1)
        probs = (audio_emb @ TEXT_EMB.T).softmax(dim=-1)[0]

    ranked = sorted(zip(LABELS, probs.tolist()), key=lambda x: x[1], reverse=True)
    top = [{"label": l, "score": round(s, 4)} for l, s in ranked[: max(1, req.top_k)]]
    return {"instrument": top[0]["label"], "confidence": top[0]["score"], "ranked": top}
