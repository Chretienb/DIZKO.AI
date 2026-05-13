# =============================================================================
#  Dizko.Ai — Local AI Audio Pipeline
#  Stem separation · BPM/key detection · AI naming · Mixing · Notifications
# =============================================================================
#
#  INSTALL DEPENDENCIES
#  --------------------
#  pip install demucs librosa pydub requests
#
#  SYSTEM REQUIREMENTS
#  -------------------
#  • ffmpeg  (required by pydub and demucs)
#      brew install ffmpeg
#
# =============================================================================

import os
import re
import json
import shutil
import subprocess
from pathlib import Path
from typing import Optional

import requests

# ── Optional heavy imports (guarded so the file loads even if not installed) ─

AUBIO_OK = False    # replaced by pure-scipy BPM detection (no C build needed)

try:
    import numpy as np
    import scipy.io.wavfile as wavfile
    import scipy.signal as signal
    SCIPY_OK = True
except ImportError:
    SCIPY_OK = False
    print("⚠  scipy/numpy not installed — key detection disabled. Run: pip install scipy numpy")

try:
    from pydub import AudioSegment
    PYDUB_OK = True
except ImportError:
    PYDUB_OK = False
    print("⚠  pydub not installed — mixing disabled. Run: pip install pydub")


# =============================================================================
#  CONFIG
# =============================================================================

FFMPEG_OK     = bool(shutil.which("ffmpeg"))
OUTPUT_ROOT   = Path("DIZKO_AI")          # all output lives here
STEMS         = ["vocals", "drums", "bass", "other"]

CHROMA_NOTES  = ["C", "C#", "D", "D#", "E", "F",
                  "F#", "G", "G#", "A", "A#", "B"]

INSTRUMENT_MAP = {          # maps stem type → friendly instrument name
    "vocals": "vocals",
    "drums":  "drums",
    "bass":   "bass",
    "other":  "other",
    "guitar": "guitar",
    "keys":   "keys",
    "synth":  "synth",
}


# =============================================================================
#  1. STEM SEPARATION  (demucs)
# =============================================================================

def separate_stems(
    audio_path: str,
    project_name: str,
    track_number: int = 1,
) -> dict[str, Path]:
    """
    Split an audio file into 4 stems using Demucs (htdemucs model).

    Returns:
        { "vocals": Path, "drums": Path, "bass": Path, "other": Path }
    """
    audio_path = Path(audio_path).resolve()
    out_dir    = _stem_dir(project_name, track_number)

    print(f"\n🎛  Separating stems for: {audio_path.name}")
    print(f"    Output → {out_dir}")

    # demucs writes to:  <out_dir>/htdemucs/<audio_stem>/<stem>.wav
    result = subprocess.run(
        [
            sys.executable, "-m", "demucs",
            "--out", str(out_dir),
            str(audio_path),
        ],
        capture_output=False,
    )

    if result.returncode != 0:
        raise RuntimeError("demucs failed — check the output above for details.")

    song_name  = audio_path.stem
    demucs_dir = out_dir / "htdemucs" / song_name
    stem_paths: dict[str, Path] = {}

    for stem in STEMS:
        src = demucs_dir / f"{stem}.wav"
        if not src.exists():
            # demucs may output mp3 depending on version
            src = demucs_dir / f"{stem}.mp3"
        if src.exists():
            stem_paths[stem] = src
            print(f"    ✓ {stem:8s} → {src.name}")
        else:
            print(f"    ✗ {stem:8s} → NOT FOUND (check demucs output)")

    return stem_paths


# =============================================================================
#  2. AUDIO ANALYSIS  (aubio for BPM, scipy/numpy for key)
# =============================================================================

def _to_wav_mono(audio_path: str) -> tuple[str, bool]:
    """Convert audio to mono 44100 Hz WAV using ffmpeg if needed. Returns (path, is_temp)."""
    p = Path(audio_path)
    if p.suffix.lower() == ".wav":
        return str(p), False
    if not FFMPEG_OK:
        print(f"    ⚠  ffmpeg not found — cannot convert {p.suffix} to WAV for analysis.")
        print("       Install ffmpeg: brew install ffmpeg")
        return str(p), False   # pass as-is; scipy may still read it
    tmp = str(p.with_suffix(".tmp_mono.wav"))
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(p), "-ac", "1", "-ar", "44100", tmp],
        capture_output=True, check=True,
    )
    return tmp, True


def _detect_bpm_scipy(wav_path: str) -> float:
    """
    Detect BPM using onset energy + autocorrelation (pure numpy/scipy — no LLVM).
    """
    sr, data = wavfile.read(wav_path)
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = data.astype(np.float32)
    if np.abs(data).max() > 1.0:
        data /= 32768.0

    # ── Onset energy envelope (RMS in small windows) ──────────────────────────
    hop     = int(sr * 0.01)    # 10 ms hop
    win     = hop * 4
    frames  = [data[i:i+win] for i in range(0, len(data) - win, hop)]
    energy  = np.array([np.sqrt(np.mean(f**2)) for f in frames])

    # Half-wave rectified first-order difference = onset strength
    onset   = np.maximum(0, np.diff(energy))
    onset   = np.concatenate([[0], onset])

    # ── Autocorrelation over a tempo-relevant lag range ────────────────────────
    fps     = sr / hop          # frames per second
    min_lag = int(fps * 60 / 200)   # 200 BPM
    max_lag = int(fps * 60 / 40)    # 40  BPM
    max_lag = min(max_lag, len(onset) // 2)

    if max_lag <= min_lag:
        return 120.0

    acorr = np.correlate(onset, onset, mode="full")
    acorr = acorr[len(acorr)//2:]    # positive lags only

    # Harmonic weighting — prefer lags whose half/double also score well
    scores = acorr[min_lag:max_lag].copy()
    for i, lag in enumerate(range(min_lag, max_lag)):
        for harmonic in [2, 3, 0.5]:
            h = int(lag * harmonic)
            if min_lag <= h < len(acorr):
                scores[i] += acorr[h] * 0.5

    best_lag = int(np.argmax(scores)) + min_lag

    # Parabolic interpolation for sub-frame accuracy
    if 0 < best_lag < len(acorr) - 1:
        a, b, c = acorr[best_lag-1], acorr[best_lag], acorr[best_lag+1]
        if 2*b - a - c != 0:
            best_lag += 0.5 * (a - c) / (2*b - a - c)

    bpm = fps * 60.0 / best_lag
    # Fold into 60–180 BPM range
    while bpm > 180: bpm /= 2
    while bpm < 60:  bpm *= 2
    return round(bpm, 1)


def _detect_key_scipy(wav_path: str) -> tuple[str, str]:
    """
    Estimate key signature from chroma features built with scipy FFT.
    Returns (key_note, mode) e.g. ("A", "minor").
    """
    sr, data = wavfile.read(wav_path)
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = data.astype(np.float32)
    if data.max() > 1.0:
        data /= 32768.0   # normalise int16

    # Build a simple chromagram via FFT bins mapped to note semitones
    n       = len(data)
    freqs   = np.fft.rfftfreq(n, 1.0 / sr)
    magnitudes = np.abs(np.fft.rfft(data))

    A4_HZ   = 440.0
    chroma  = np.zeros(12)
    for i, f in enumerate(freqs):
        if f < 27.5 or f > 4186:
            continue
        semitone = round(12 * np.log2(f / A4_HZ)) % 12
        chroma[semitone] += magnitudes[i]

    if chroma.max() > 0:
        chroma /= chroma.max()

    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                               2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                               2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    best_key, best_mode, best_corr = "C", "major", -999.0
    for i in range(12):
        rotated = np.roll(chroma, -i)
        for profile, mode in [(major_profile, "major"), (minor_profile, "minor")]:
            corr = float(np.corrcoef(rotated, profile)[0, 1])
            if corr > best_corr:
                best_corr, best_key, best_mode = corr, CHROMA_NOTES[i], mode

    return best_key, best_mode


def analyze_audio(audio_path: str) -> dict:
    """
    Detect BPM and key signature from an audio file.

    Returns:
        { "bpm": float, "key": str, "mode": str, "key_str": str }
    """
    print(f"\n🔍 Analyzing: {Path(audio_path).name}")

    wav_path, is_temp = _to_wav_mono(audio_path)
    bpm  = 120.0
    key  = "C"
    mode = "major"

    try:
        if SCIPY_OK:
            bpm = _detect_bpm_scipy(wav_path)
            key, mode = _detect_key_scipy(wav_path)
        else:
            print("    ⚠  scipy missing — defaulting to 120 BPM / C major. Run: pip install scipy numpy")
    finally:
        if is_temp and Path(wav_path).exists():
            Path(wav_path).unlink()

    mode_abbr = "m" if mode == "minor" else ""
    key_str   = f"{key}{mode_abbr}"
    print(f"    BPM : {bpm}")
    print(f"    Key : {key_str} ({mode})")
    return {"bpm": bpm, "key": key, "mode": mode, "key_str": key_str}


# =============================================================================
#  3. FILE NAMING
# =============================================================================

def generate_stem_name(
    stem_type:    str,
    track_number: int,
    bpm:          float,
    key:          str,
    artist_name:  Optional[str] = None,
    take_number:  int = 1,
) -> str:
    """Generate a clean filename for a stem from its metadata."""
    artist_clean = re.sub(r'\W+', '', (artist_name or "unknown").lower())
    filename = (
        f"track{track_number:02d}_{artist_clean}_{stem_type}"
        f"_take{take_number}_{int(bpm)}bpm_{key}.wav"
    )
    return filename


# =============================================================================
#  4. STEM MIXING  (pydub)
# =============================================================================

def mix_stems(
    stem_paths:   list[str | Path],
    output_path:  str | Path,
    volumes_db:   Optional[dict[str, float]] = None,
) -> Path:
    """
    Mix a list of stem files together and export as .mp3.

    Args:
        stem_paths   : list of paths to .wav / .mp3 stems
        output_path  : destination .mp3 file path
        volumes_db   : optional { filename_key: dB_adjustment } e.g. {"vocals": -3.0}

    Returns:
        Path to the exported .mp3 file.
    """
    if not PYDUB_OK:
        raise RuntimeError("pydub is not installed. Run: pip install pydub")

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    volumes_db  = volumes_db or {}

    print(f"\n🎚  Mixing {len(stem_paths)} stems → {output_path.name}")
    mix: Optional[AudioSegment] = None

    for path in stem_paths:
        path = Path(path)
        if not path.exists():
            print(f"    ⚠  Skipping missing file: {path}")
            continue

        seg = AudioSegment.from_file(str(path))

        # Apply per-stem volume adjustment
        key = path.stem.split("_")[0]   # "vocals", "drums" etc.
        if key in volumes_db:
            seg = seg + volumes_db[key]
            print(f"    ↕  {key:8s} volume {volumes_db[key]:+.1f} dB")

        mix = seg if mix is None else mix.overlay(seg)
        print(f"    ✓  Added: {path.name}  ({len(seg)/1000:.1f}s)")

    if mix is None:
        raise ValueError("No valid stem files to mix.")

    fmt  = "mp3" if FFMPEG_OK else "wav"
    ext  = ".mp3" if FFMPEG_OK else ".wav"
    out  = output_path.with_suffix(ext)
    kwargs = {"format": fmt, "bitrate": "320k"} if FFMPEG_OK else {"format": fmt}
    mix.export(str(out), **kwargs)
    if not FFMPEG_OK:
        print("    ⚠  ffmpeg missing — exported as WAV instead of MP3. Install ffmpeg for MP3 output.")
    print(f"    💾 Exported: {out}  ({out.stat().st_size // 1024} KB)")
    return out


# =============================================================================
#  5. FOLDER STRUCTURE
# =============================================================================

def _stem_dir(project_name: str, track_number: int) -> Path:
    """Return (and create) the stems directory for a given project + track."""
    clean   = re.sub(r'\W+', '_', project_name).strip('_')
    track   = f"Track_{track_number:02d}"
    path    = OUTPUT_ROOT / clean / track / "stems"
    path.mkdir(parents=True, exist_ok=True)
    return path.parent      # returns Track_XX/  (demucs writes into stems/ itself)


def save_named_stems(
    stem_paths:   dict[str, Path],
    named_stems:  dict[str, str],
    project_name: str,
    track_number: int,
) -> dict[str, Path]:
    """
    Copy demucs output stems to the organised folder with AI-generated names.

    Returns:
        { stem_type: final_Path }
    """
    stems_dir = _stem_dir(project_name, track_number) / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)
    final: dict[str, Path] = {}

    for stem_type, src_path in stem_paths.items():
        if stem_type not in named_stems:
            continue
        dest = stems_dir / named_stems[stem_type]
        shutil.copy2(src_path, dest)
        final[stem_type] = dest
        print(f"    📁 {stem_type:8s} → {dest.relative_to(OUTPUT_ROOT)}")

    return final


# =============================================================================
#  6. PUSH NOTIFICATION LOG
# =============================================================================

def notify_upload(
    artist_name:  str,
    stem_type:    str,
    track_number: int,
    instrument:   Optional[str] = None,
) -> None:
    """Print a formatted upload notification."""
    emoji_map = {
        "vocals": "🎤",
        "drums":  "🥁",
        "bass":   "🎸",
        "other":  "🎹",
        "guitar": "🎸",
        "keys":   "🎹",
        "synth":  "🎛",
    }
    instr  = instrument or stem_type
    emoji  = emoji_map.get(instr.lower(), "🎵")
    track  = f"Track {track_number}"
    print(f"\n🔔  {artist_name} {emoji} just uploaded a new {instr} recording for {track}!")


def notify_mix(
    artist_name:  str,
    track_number: int,
    output_path:  str | Path,
) -> None:
    """Print a mix-complete notification."""
    print(f"\n🎧  Mix complete for Track {track_number} by {artist_name}!")
    print(f"    File: {output_path}")


# =============================================================================
#  FULL PIPELINE  (run all steps together)
# =============================================================================

def run_pipeline(
    audio_path:   str,
    project_name: str,
    artist_name:  str,
    track_number: int  = 1,
    take_number:  int  = 1,
    mix_output:   bool = True,
) -> dict:
    """
    Run the complete Dizko.Ai pipeline on a single audio file.

    Steps:
        1. Separate stems (demucs)
        2. Analyze BPM + key (librosa)
        3. Generate file names from metadata
        4. Save organized folder structure
        5. Bounce a preview mix (pydub)
        6. Send upload notification

    Returns:
        {
          "stems":      { stem_type: Path },
          "analysis":   { bpm, key, ... },
          "names":      { stem_type: filename },
          "mix":        Path | None,
        }
    """
    print(f"\n{'='*60}")
    print(f"  Dizko.Ai Pipeline")
    print(f"  Project : {project_name}")
    print(f"  Artist  : {artist_name}")
    print(f"  Track   : {track_number:02d}  |  Take: {take_number}")
    print(f"{'='*60}")

    # 1. Stem separation
    raw_stems = separate_stems(audio_path, project_name, track_number)

    # 2. Audio analysis (on original file)
    analysis = analyze_audio(audio_path)
    bpm      = analysis["bpm"]
    key      = analysis["key_str"]

    # 3. AI file naming + 6. Notification
    print("\n🤖 Generating AI file names...")
    named: dict[str, str] = {}
    for stem_type in raw_stems:
        named[stem_type] = generate_stem_name(
            stem_type    = stem_type,
            track_number = track_number,
            bpm          = bpm,
            key          = key,
            artist_name  = artist_name,
            take_number  = take_number,
        )
        notify_upload(artist_name, stem_type, track_number, stem_type)

    # 4. Save with organised names
    print("\n📁 Organising files...")
    final_stems = save_named_stems(raw_stems, named, project_name, track_number)

    # 5. Mix
    mix_path: Optional[Path] = None
    if mix_output and PYDUB_OK:
        mix_file = (
            _stem_dir(project_name, track_number)
            / f"track{track_number:02d}_{artist_name.lower()}_mix_{int(bpm)}bpm_{key}.mp3"
        )
        mix_path = mix_stems(list(final_stems.values()), mix_file)
        notify_mix(artist_name, track_number, mix_path)

    print(f"\n✅  Pipeline complete for Track {track_number:02d}")
    return {
        "stems":    final_stems,
        "analysis": analysis,
        "names":    named,
        "mix":      mix_path,
    }


# =============================================================================
#  QUICK TEST
# =============================================================================

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python3 dizko_ai.py <audio_file> [project_name] [artist] [track#] [take#]")
        print("Example:")
        print("  python3 dizko_ai.py song.mp3 'Sem vol 1' Christian 2 1")
        sys.exit(0)

    run_pipeline(
        audio_path   = sys.argv[1],
        project_name = sys.argv[2] if len(sys.argv) > 2 else "My Project",
        artist_name  = sys.argv[3] if len(sys.argv) > 3 else "Artist",
        track_number = int(sys.argv[4]) if len(sys.argv) > 4 else 1,
        take_number  = int(sys.argv[5]) if len(sys.argv) > 5 else 1,
    )
