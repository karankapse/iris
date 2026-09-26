import anthropic
from fastapi import APIRouter, HTTPException, Request

from app.config import get_settings
from app.schemas import SuggestionsRequest, SuggestionsResponse
from app.services.llm import generate_suggestions

router = APIRouter(prefix="/api", tags=["conversation"])


@router.post("/suggestions", response_model=SuggestionsResponse)
def suggestions(req: SuggestionsRequest, request: Request) -> SuggestionsResponse:
    settings = getattr(request.app.state, "settings", None) or get_settings()
    try:
        items = generate_suggestions(settings, req.history, req.mood, req.profile, req.reaction)
    except anthropic.APIError as e:
        # Don't leak details to the client; the message is enough to show a retry prompt.
        raise HTTPException(status_code=502, detail=f"Claude API error: {type(e).__name__}") from e
    return SuggestionsResponse(suggestions=items)
