# The Iris backend (FastAPI) for a server host such as Railway. Build from the REPO ROOT, since the
# backend reads shared/default-phrases.json:  docker build -f backend/Dockerfile .
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_CACHE=1 PYTHONUNBUFFERED=1
WORKDIR /app/backend

# dependencies first (cached between deploys when only code changes)
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY shared/ /app/shared/
COPY backend/ ./
RUN uv sync --frozen --no-dev

# accounts, calibrations and emotion models: keep this on a persistent volume mounted at /data
ENV DATABASE_PATH=/data/iris.db
EXPOSE 8000
CMD ["sh", "-c", "exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
