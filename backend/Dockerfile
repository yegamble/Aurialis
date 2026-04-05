# Smart Split Backend — Demucs stem separation service
# Supports both GPU (nvidia-docker) and CPU-only modes.
#
# Build: docker compose build
# Run:   docker compose up

FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04 AS gpu-base

# Install Python 3.11
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

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
