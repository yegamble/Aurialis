# Smart Split Backend — Demucs stem separation service
# CPU-only by default. Works on macOS, Linux, and Windows.
#
# Build: docker compose build
# Run:   docker compose up

FROM python:3.11-slim

# System deps:
#   ffmpeg     — required by Demucs
#   libsndfile1 — required by soundfile / librosa
#   gcc, g++   — required to build madmom's C/Cython extensions (madmom does
#                not publish manylinux wheels for aarch64 / cp311; pip falls
#                back to source build, which needs a compiler)
#   git        — pip needs it if requirements.txt ever switches to a git ref
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 gcc g++ git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies (CPU-only PyTorch).
# madmom 0.16.1's setup.py imports Cython.Build at metadata-generation time
# (before pip can resolve setup_requires), so Cython MUST be present before
# `pip install -r requirements.txt`. madmom also uses pre-NumPy-2 C APIs, so
# we pin numpy<2 in the same pre-install step. Both are deliberately ordered
# before requirements.txt — do not merge into a single pip call.
COPY requirements.txt .
RUN pip install --no-cache-dir \
    torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir "numpy<2" "Cython>=0.29,<3" \
    && pip install --no-cache-dir -r requirements.txt

# Pre-download Demucs models so first run doesn't stall
RUN python -c "\
from demucs.pretrained import get_model; \
get_model('htdemucs'); \
get_model('htdemucs_6s'); \
print('Models downloaded successfully')"

COPY . .

# Create temp directory for separation outputs
RUN mkdir -p /tmp/smart-split

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
