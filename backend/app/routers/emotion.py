import uuid

from fastapi import APIRouter, HTTPException

from app.deps import DbDep
from app.schemas import EmotionModel, SamplesRequest, TrainRequest
from app.services.emotion_trainer import NotEnoughData, train_model

router = APIRouter(prefix="/api/emotion", tags=["emotion"])


@router.post("/samples", status_code=201)
def add_samples(req: SamplesRequest, db: DbDep) -> dict:
    for s in req.samples:
        if len(s.features) != len(req.feature_names):
            raise HTTPException(422, "Each sample must have one value per feature name")
    db.add_samples(
        req.user_id,
        req.feature_names,
        [(s.label, s.features, s.source) for s in req.samples],
        recording=uuid.uuid4().hex,  # one request = one recording (for honest accuracy checks)
    )
    return {"stored": len(req.samples)}


@router.post("/train", response_model=EmotionModel)
def train(req: TrainRequest, db: DbDep) -> EmotionModel:
    try:
        model = train_model(req.user_id, db.get_samples(req.user_id))
    except NotEnoughData as e:
        raise HTTPException(422, str(e)) from e
    db.save_model(req.user_id, model.model_dump_json())
    return model


@router.get("/model/{user_id}", response_model=EmotionModel)
def get_model(user_id: str, db: DbDep) -> EmotionModel:
    stored = db.get_model(user_id)
    if stored is None:
        raise HTTPException(404, "No trained model for this user yet")
    return EmotionModel.model_validate_json(stored)
