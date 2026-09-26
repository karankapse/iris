"""FastAPI entry point. Run with: `uv run uvicorn app.main:app --reload` (from backend/)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.db import Database
from app.routers import conversation, emotion, feedback, stt


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Iris API", version="0.1.0")
    app.state.db = Database(settings.database_path)

    # The Vite dev server runs on another port, so allow it (dev only).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict:
        return {
            "ok": True,
            "mock_llm": settings.use_mock_llm,
            "stt_configured": bool(settings.model_api_key),
        }

    app.include_router(conversation.router)
    app.include_router(emotion.router)
    app.include_router(feedback.router)
    app.include_router(stt.router)
    return app


app = create_app()
