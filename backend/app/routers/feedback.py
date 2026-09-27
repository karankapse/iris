from fastapi import APIRouter

from app.deps import DbDep
from app.schemas import FeedbackRequest

router = APIRouter(prefix="/api", tags=["feedback"])


@router.post("/feedback", status_code=201)
def add_feedback(req: FeedbackRequest, db: DbDep) -> dict:
    db.add_feedback(
        req.user_id,
        req.utterance_id,
        req.reply_text,
        req.spoken_tone,
        req.user_tone_ok,
        req.partner_reaction,
    )
    # the conversation memory learns whether that tone was right, too
    db.rate_exchange(req.user_id, req.utterance_id, req.user_tone_ok, req.partner_reaction)

    # Learning rule (deliberately simple, students can improve it):
    # if the user said "yes, that tone was right", the face features captured at that
    # moment are a trustworthy example of the spoken tone -> add them as a training sample.
    # Several frames from the reaction window beat one snapshot; frames of the wrong length
    # (an older feature layout) are skipped.
    turned_into_sample = False
    frames = req.feature_frames or ([req.features] if req.features else [])
    if req.user_tone_ok is True and frames and req.feature_names:
        rows = [
            (req.spoken_tone, f, "feedback") for f in frames if len(f) == len(req.feature_names)
        ]
        if rows:
            db.add_samples(
                req.user_id, req.feature_names, rows, recording=f"feedback-{req.utterance_id}"
            )
            turned_into_sample = True
    return {"stored": True, "added_training_sample": turned_into_sample}
