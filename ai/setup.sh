#!/bin/zsh
# =============================================================================
#  Dizko.Ai — Python Environment Setup
#  Run once: zsh ai/setup.sh
# =============================================================================

set -e

AI_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$AI_DIR/.venv"

echo ""
echo "  Dizko.Ai AI Pipeline — Setup"
echo "  =============================="

# ── 1. Find Python 3.11 ──────────────────────────────────────────────────────
PY=""
for candidate in \
  /opt/homebrew/bin/python3.11 \
  /usr/local/bin/python3.11   \
  python3.11; do
  if command -v "$candidate" &>/dev/null; then
    PY="$candidate"
    break
  fi
done

if [ -z "$PY" ]; then
  echo ""
  echo "  ⚠  Python 3.11 not found."
  echo "  Run: brew install python@3.11"
  echo "  Then re-run this script."
  exit 1
fi

echo "  ✓ Python: $($PY --version)"

# ── 2. Create virtual environment ────────────────────────────────────────────
if [ ! -d "$VENV" ]; then
  echo "  Creating venv at $VENV ..."
  "$PY" -m venv "$VENV"
fi

PIP="$VENV/bin/pip"
PY3="$VENV/bin/python"

# ── 3. Install dependencies ──────────────────────────────────────────────────
echo ""
echo "  Installing dependencies (this may take a few minutes)..."
"$PIP" install --upgrade pip --quiet

"$PIP" install torch torchaudio --index-url https://download.pytorch.org/whl/cpu --quiet
echo "  ✓ PyTorch (CPU)"

"$PIP" install demucs --quiet
echo "  ✓ demucs"

"$PIP" install scipy numpy --quiet
echo "  ✓ scipy + numpy (BPM + key detection)"

"$PIP" install pydub requests --quiet
echo "  ✓ pydub + requests"

# ── 4. ffmpeg check ──────────────────────────────────────────────────────────
if command -v ffmpeg &>/dev/null; then
  echo "  ✓ ffmpeg: $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3)"
else
  echo ""
  echo "  ⚠  ffmpeg not found."
  echo "     WAV files work without it. For MP3/M4A input, free disk space then:"
  echo "       brew install ffmpeg"
fi

# ── 5. Ollama check ──────────────────────────────────────────────────────────
if curl -s http://localhost:11434/api/tags &>/dev/null; then
  echo "  ✓ Ollama: running with llama3.2"
else
  echo "  ⚠  Ollama not running. Start it: open /Applications/Ollama.app"
fi

echo ""
echo "  Setup complete! Run the pipeline with:"
echo ""
echo "    $VENV/bin/python ai/dizko_ai.py <audio_file> \"Project Name\" \"Artist\" <track#>"
echo ""
echo "  Example:"
echo "    $VENV/bin/python ai/dizko_ai.py song.mp3 \"Sem vol 1\" Christian 2 1"
echo ""
