# Smart Split Backend — Demucs stem separation service
# CPU-only by default. Works on macOS, Linux, and Windows.
#
# Build: docker compose build
# Run:   docker compose up

FROM python:3.11-slim

# Install ffmpeg (required by Demucs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies (CPU-only PyTorch)
COPY requirements.txt .
RUN pip install --no-cache-dir \
    torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
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
