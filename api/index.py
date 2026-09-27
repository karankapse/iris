"""Vercel entry point: the whole FastAPI backend (backend/app) as one serverless function.
vercel.json sends every /api/... request here; FastAPI routes it as usual."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app  # noqa: E402

__all__ = ["app"]
