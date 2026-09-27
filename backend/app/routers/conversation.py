import anthropic
from fastapi import APIRouter, HTTPException, Request

from app.config import get_settings
from app.deps import DbDep
from app.schemas import (
    ExchangeLog,
    ExpandRequest,
    MemoryResponse,
    RelatedRequest,
    RelatedResponse,
    SuggestionsRequest,
    SuggestionsResponse,
)
from app.services.conversation_memory import memory_prompt, similar_moments
from app.services.llm import expand_initials, generate_reply_bundle
from app.services.related import is_related

router = APIRouter(prefix="/api", tags=["conversation"])


@router.post("/suggestions", response_model=SuggestionsResponse)
def suggestions(req: SuggestionsRequest, request: Request, db: DbDep) -> SuggestionsResponse:
    settings = getattr(request.app.state, "settings", None) or get_settings()
    # How this person felt and replied in similar past moments (empty if nothing similar).
    partner = next((t.text for t in reversed(req.history) if t.speaker == "partner"), "")
    memory = (
        memory_prompt(similar_moments(db.recent_exchanges(req.user_id), partner)) if partner else ""
    )
    try:
        items, feel = generate_reply_bundle(
            settings, req.history, req.mood, req.profile, req.reaction, memory, req.face_reaction
        )
    except anthropic.APIError as e:
        # Don't leak details to the client; the message is enough to show a retry prompt.
        raise HTTPException(status_code=502, detail=f"Claude API error: {type(e).__name__}") from e
    return SuggestionsResponse(suggestions=items, conversation_emotion=feel)


@router.post("/expand", response_model=SuggestionsResponse)
def expand(req: ExpandRequest, db: DbDep) -> SuggestionsResponse:
    """First-letter typing: "iww" -> "I want water" (using the conversation and the memory)."""
    partner = next((t.text for t in reversed(req.history) if t.speaker == "partner"), "")
    memory = (
        memory_prompt(similar_moments(db.recent_exchanges(req.user_id), partner)) if partner else ""
    )
    try:
        items = expand_initials(
            get_settings(), req.initials, req.history, req.mood, req.profile, memory
        )
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {type(e).__name__}") from e
    return SuggestionsResponse(suggestions=items)


@router.post("/related", response_model=RelatedResponse)
def related(req: RelatedRequest, request: Request) -> RelatedResponse:
    """Is speech heard while replies were loading part of the same turn? (fast model)"""
    settings = getattr(request.app.state, "settings", None) or get_settings()
    try:
        return RelatedResponse(related=is_related(settings, req.previous, req.new))
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {type(e).__name__}") from e


@router.post("/conversation/log", status_code=201)
def log_exchange(req: ExchangeLog, db: DbDep) -> dict:
    """Remember one moment: what was said, how the user felt, what they replied."""
    if not req.partner_text.strip():
        return {"stored": False}  # nothing was said to them (e.g. a quick phrase): nothing to learn
    db.add_exchange(req.user_id, req.model_dump())
    return {"stored": True}


@router.get("/conversation/memory/{user_id}", response_model=MemoryResponse)
def get_memory(user_id: str, db: DbDep, limit: int = 20) -> MemoryResponse:
    rows = db.recent_exchanges(user_id, limit=500)
    entries = [
        {**r, "tone_ok": None if r["tone_ok"] is None else bool(r["tone_ok"])}
        for r in rows[: max(0, limit)]
    ]
    return MemoryResponse(count=len(rows), entries=entries)


@router.delete("/conversation/memory/{user_id}")
def forget(user_id: str, db: DbDep) -> dict:
    return {"deleted": db.clear_exchanges(user_id)}
