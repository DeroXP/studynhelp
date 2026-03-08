# syntax=docker/dockerfile:1.7
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080
WORKDIR /app

# Install system deps + Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Build frontend
COPY frontend ./frontend
RUN cd frontend && npm install && npm run build

# Copy backend
COPY backend ./backend

EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
