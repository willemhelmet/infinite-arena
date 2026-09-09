FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# The MVP broadcasts directly; the optional VHS CLI is not bundled.
WORKDIR /app
COPY broadcaster/requirements.txt /app/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"
COPY broadcaster /app/broadcaster
CMD ["python", "-u", "broadcaster/main.py"]
