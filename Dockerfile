# NeuroBridge FastAPI backend — Google Cloud Run image.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    LOG_FORMAT=json \
    PORT=8080

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend/ backend/
RUN rm -rf backend/venv backend/tests backend/__pycache__ \
    && useradd --uid 10001 --create-home app \
    && chown -R app /app
USER app

# Cloud Run injects $PORT. --proxy-headers so client scheme/IP come from Google's front end.
CMD exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'
