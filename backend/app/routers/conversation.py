import anthropic
from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.schemas import SuggestionsRequest, SuggestionsResponse
from app.services.llm import generate_suggestions

router = APIRouter(prefix="/api", tags=["conversation"])


@router.post("/suggestions", response_model=SuggestionsResponse)
def suggestions(req: SuggestionsRequest) -> SuggestionsResponse:
    try:
        items = generate_suggestions(get_settings(), req.history, req.mood)
    except anthropic.APIError as e:
        # Don't leak details to the client; the message is enough to show a retry prompt.
        raise HTTPException(status_code=502, detail=f"Claude API error: {type(e).__name__}") from e
    return SuggestionsResponse(suggestions=items)
