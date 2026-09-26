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

    # Learning rule (deliberately simple, students can improve it):
    # if the user said "yes, that tone was right", the face features captured at that
    # moment are a trustworthy example of the spoken tone -> add them as a training sample.
    turned_into_sample = False
    if req.user_tone_ok is True and req.features and req.feature_names:
        if len(req.features) == len(req.feature_names):
            db.add_samples(
                req.user_id, req.feature_names, [(req.spoken_tone, req.features, "feedback")]
            )
            turned_into_sample = True
    return {"stored": True, "added_training_sample": turned_into_sample}
